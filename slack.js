const https = require('https');
const WebSocket = require('ws');
const { TOKEN, TEAM_ID } = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt,} = require('./utils');

function Uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendMessage(message) {
  return new Promise((resolve, reject) => {

    const blocks_json = [{ "type": "rich_text", "elements": [{ "type": "rich_text_section", "elements": [{ "type": "text", "text": message }] }] }];
    const blocks_txt = JSON.stringify(blocks_json);
    const form = createBaseForm();
    form.append('ts', convertToUnixTime(new Date()));
    form.append('type', 'message');
    form.append('xArgs', '{}');
    form.append('unfurl', '[]');
    form.append('blocks', blocks_txt);
    form.append('include_channel_perm_error', 'true');
    form.append('client_msg_id', Uuidv4());
    form.append('_x_reason', 'webapp_message_send');

    const options = {
      method: 'POST',
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
    };

    const req = https.request(`https://${TEAM_ID}.slack.com/api/chat.postMessage`, options, async (res) => {
      try {
        console.log(blocks_txt.length, "characters");
        const response = await readBody(res, true);
        if (!response.ok) {
          reject(new Error("message response:" + response.error.toString() + "\nrequest:" + form.getBuffer() + "\n"));
          return;
        }
        resolve(response);
      } catch (error) {
        console.trace(error.toString().slice(7,));
        reject(new Error(error.message + "| " + "while sending message " + " request:" + form.getBuffer() + "\n"));
      }
    });

    req.on('error', (error) => {
      console.trace(error.toString().slice(7,));
    });

    form.pipe(req);
  });
}

async function getFilter(msg, fMessage){
  if (msg.type == "desktop_notification") {
    let slackfilterMessage = msg.content;
    if(fMessage.length == 0){
      if(slackfilterMessage.includes("&gt; _*Please note:*")){
        if(slackfilterMessage.includes("math")){
          fMessage += "\u001b[32mPlease note: Claude is not skilled at solving math problems.\u001b[0m";
        }
        if(slackfilterMessage.includes("violate")){
          fMessage += "\u001b[31mPlease note: This request may violate our Acceptable Use Policy.\n\u001b[36mAdd math bloat to your prompts or reduce your NSFW words.\u001b[0m";
        }
      }
    }
    return fMessage;
  }
  else{
    return fMessage;
  }
}

async function sendChatReset() {
  return new Promise((resolve, reject) => {
    const form = createBaseForm();

    form.append('command', '/reset');
    form.append('disp', '/reset');
    form.append('client_token', `${new Date().getTime()}`);
    form.append('_x_reason', 'executeCommand');

    const options = {
      method: 'POST',
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
    };

    const req = https.request(`https://${TEAM_ID}.slack.com/api/chat.command`, options, async (res) => {
      try {
        const response = await readBody(res, true);
        console.log(response);
        resolve(response); // Resolve with the response data
      } catch (error) {
        console.trace(error.toString().slice(7,));
        reject(new Error(error.message + "| " + "sendChatReset: " + " request:" + form.getBuffer() + "\n"));
      }
    });

    req.on('error', (error) => {
      console.trace(error.toString().slice(7,));
      reject(error); // Reject with the error
    });

    form.pipe(req);
  });
}

async function streamResponse(slices, sendChunks) {
  const resultStream = await getWebSocketResponse(slices, true);
  const reader = resultStream.getReader();
  let nextChunk = await reader.read();
  while (true) {
    sendChunks(nextChunk);
    if (nextChunk.done) {
      return;
    }
    nextChunk = await reader.read();
  }
}

async function retryableWebSocketResponse(slices, sendChunks) {
  try {
    if (sendChunks) {
      return await streamResponse(slices, sendChunks);
    } else {
      return await getWebSocketResponse(slices, sendChunks);
    }
  } catch (error) {
    console.error("Error: "+error.message);
    }
}

async function getWebSocketResponse(messages, streaming) {
  return new Promise(async (resolve, reject) => {
    try {
      await sendChatReset();
    } catch (error) {
      console.error("Error: "+ error.message+ " | " + "CHECK YOUR TOKENS, COOKIES / config.js");
    }

    const websocketURL = `wss://wss-primary.slack.com/?token=${TOKEN}`;

    const websocket = new WebSocket(websocketURL, {
      headers: headers,
    });

    const waitForConnection = new Promise((connectionResolve) => {
      websocket.on('open', () => {
        console.log('\n=== Connected to Slack ===');
        connectionResolve();
      });
    });

    await waitForConnection;
    let messageIndex = 0;
    let sentTs = null;
    prompt = buildPrompt(messages[0]);
    const sendNextPrompt = async () => {
      if (messageIndex < prompt.length) {
        console.log("\n=== Sending Prompt ===")
        const chunk = prompt[messageIndex];
        console.log("Sending %d/%d", messageIndex+1, prompt.length);
        try {
          response = await sendMessage(chunk);
          sentTs = response.ts;
        } catch (error) {
          console.trace(error.stack);
          throw (new Error(error.message + "| " + `getWebSocketResponse: ${error.message}`))
        }
        console.log("Sent %d/%d", messageIndex+1, prompt.length);
        messageIndex++;
      }
    };

    try {
      await sendNextPrompt();
    } catch (error) {
      console.trace(error);
      reject(new Error(error.message + "| " + `sendNextPrompt: ${error.message}`));
    }

    let typingString = "\n\n_Typing…_";
    let filterMessage = "";
    if (!streaming) {
      // resolve the full text at the end only
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          filterMessage = await getFilter(data, filterMessage);
          // Extract the sender ID from the payload
          if (data.message) {
            if (data.subtype === 'message_changed') {
              if (messageIndex < prompt.length) {
                // while context to send still...
                if (!data.message.text.endsWith(typingString)) {
                  console.log("\n=== Receiving Confirmation ===");
                  try {
                    console.log(filterMessage);
                    await sendNextPrompt();
                    filterMessage = "";
                  } catch (error) {
                    console.trace(error);
                    throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                  }
                }
              } else {
                if (messageIndex == prompt.length) {
                  console.log("\n=== Receiving Message ===");
                  console.log("Streaming Disabled. Waiting for the response to finish...");
                  console.log(filterMessage);
                  messageIndex++;
                }
                // all context sent, getting actual reply
                if (!data.message.text.endsWith(typingString)) {
                  // when typing finished, this is the end of the message
                  websocket.close(1000, 'Connection closed by client');
                  resolve(data.message.text);
                  console.log("Finished Streaming.", data.message.text.length, "characters received.");
                } else {
                  let actualLength = data.message.text.length - typingString.length;
                  let currentTextTotal = data.message.text.slice(0, actualLength);
                  console.log(currentTextTotal.length, "characters received.");
                }
              }
            }
          }
        } catch (error) {
          console.trace(error);
          websocket.close(1000, 'Connection closed by client');
          reject(new Error(error.message + "| " + "getWebSocketResponse: "))
        }
      });
      websocket.on('desktop_notification', async(data) => {
        const warningData = JSON.parse(data);
        console.log(getWarningMessage(warningData.content));
      });
      websocket.on('error', (error) => {
        console.trace(error);
        controller.error(new Error(error.message + "| " + 'WebSocket error'));
      });
      websocket.on('close', (code, reason) => {
        if (code != 1000) {
          console.log(`WebSocket closed with code ${code} and reason: ${reason.toString()}`);
        }
      });
    } else {
      // resolve a ReadableStream to stream the websocket's response
      let stream = new ReadableStream({
        start(controller) {
          let currentSlice = 0;
          websocket.on('message', async (message) => {
            try {
              const data = JSON.parse(message);
              // Extract the sender ID from the payload
              filterMessage = await getFilter(data, filterMessage);
              if (data.message) {
                if (data.subtype === 'message_changed') {
                  if (messageIndex < prompt.length) {
                    // while context to send still...
                    if (!data.message.text.endsWith(typingString)) {
                      console.log("\n=== Receiving Confirmation ===");
                      try {
                        console.log(filterMessage);
                        await sendNextPrompt();
                        filterMessage = "";
                      } catch (error) {
                        console.trace(error);
                        throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                      }
                    }
                  } 
                  else {
                    if (messageIndex == prompt.length){
                      console.log("\n=== Receiving Message ===");
                      console.log("Streaming Enabled. Streaming Response...");
                      console.log(filterMessage);
                      messageIndex++;
                    }
                    // all context sent, getting actual reply
                    if (!data.message.text.endsWith(typingString)) {
                      // when typing finished, this is the end of the message
                      let currentTextChunk = data.message.text.slice(currentSlice);
                      currentSlice = data.message.text.length;
                      console.log("Finished Streaming.", data.message.text.length, "characters received.");
                      currentTextChunk = currentTextChunk.replace(/\*/g, '');
                      controller.enqueue(currentTextChunk);
                      controller.close();
                      websocket.close(1000, 'Connection closed by client');
                    } else {
                      let actualLength = data.message.text.length - typingString.length
                      let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                      currentSlice = actualLength
                      console.log(currentTextChunk.length, "characters received.");
                      currentTextChunk = currentTextChunk.replace(/\*/g, '');
                      controller.enqueue(currentTextChunk);
                    }
                  }
                }
              }
            } catch (error) {
              console.trace(error.toString().slice(7,));
              websocket.close(1000, 'Connection closed by client');
              controller.error(new Error(error.message + "| " + "getWebSocketResponse: "));
            }
          });
          websocket.on('error', (error) => {
            console.trace(error);
            controller.error(new Error(error.message + "| " + 'WebSocket error'));
          });
          websocket.on('close', (code, reason) => {
            if (code != 1000) {
              console.log(`WebSocket closed with code ${code} and reason: ${reason.toString()}`);
            }
          });

        }
      });

      resolve(stream);
    }
  });
}

module.exports = {
  sendMessage,
  sendChatReset,
  getWebSocketResponse,
  retryableWebSocketResponse,
};