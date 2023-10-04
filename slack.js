const https = require('https');
const WebSocket = require('ws');

const { TOKEN, TEAM_ID, CLAUDE_MEMBER_ID } = require('./config');
const {
  jail_context_retry_attempts,
  jail_retry_attempts,
  retry_delay,
  minimum_response_size_retry_attempts,
} = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt,} = require('./utils');


const editting = false; // useless feature (for now)

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
        console.log("Length: ", blocks_txt.length);
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

async function streamResponse(slices, sendChunks, retries) {
  const resultStream = await getWebSocketResponse(slices, true, retries);
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

async function retryableWebSocketResponse(slices, sendChunks, retries = {
  "Jailbreak context failed": jail_context_retry_attempts,
  "Jailbreak failed": jail_retry_attempts,
  "Retry, reply was too small": minimum_response_size_retry_attempts,
}, retryDelay = retry_delay) {
  try {
    if (sendChunks) {
      return await streamResponse(slices, sendChunks, retries = retries);
    } else {
      return await getWebSocketResponse(slices, sendChunks, retries = retries);
    }
  } catch (error) {
    for (let key in retries) {
      let retryOnErrorString = key;
      let retryCount = retries[key]
      if (retryCount <= 0) {
        continue;
      }
      if (error.message.includes(retryOnErrorString)) {
        console.log(retryOnErrorString, "retries left:", retryCount);
        console.log("+ Retrying: retryable error found while attempted to streamResponse:", retryOnErrorString);
        if (retryDelay) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        retries[retryOnErrorString] = retries[retryOnErrorString] - 1;
        return retryableWebSocketResponse(slices, sendChunks, retries, retryDelay);
      }
    }

    for (let retryOnErrorString in retries) {
      if (error.message.includes(retryOnErrorString)) {
        if (retries[retryOnErrorString] <= 0) {
          throw new Error("Retries exhausted");
        }
      }
    }
    console.trace(error);
    throw new Error(error.message + "| " + "retryableWebSocketResponse");
  }
}

async function getWebSocketResponse(messages, streaming, retries) {
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
        console.log('Connected to Slack.');
        connectionResolve();
      });
    });

    await waitForConnection;

    let messageIndex = 0;
    let sentTs = null;
    prompt = buildPrompt(messages[0]);
    const sendNextPrompt = async () => {
      if (messageIndex < prompt.length) {
        const chunk = prompt[messageIndex];
        console.log("Sending Prompt %d/%d", messageIndex+1, prompt.length);
        try {
          response = await sendMessage(chunk);
          sentTs = response.ts;
        } catch (error) {
          console.trace(error.stack);
          throw (new Error(error.message + "| " + `getWebSocketResponse: ${error.message}`))
        }
        console.log("Sent Prompt %d/%d", messageIndex+1, prompt.length);
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

    if (!streaming) {
      // resolve the full text at the end only
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          // Extract the sender ID from the payload
          if (data.message) {
            let senderId = data.message.user;
            if (data.subtype === 'message_changed' && (!editting || (CLAUDE_MEMBER_ID && senderId === CLAUDE_MEMBER_ID))) {
              if (messageIndex < prompt.length) {
                // while context to send still...
                if (!data.message.text.endsWith(typingString)) {
                  try {
                    await sendNextPrompt();
                  } catch (error) {
                    console.trace(error);
                    throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                  }
                }
              } else {
                // all context sent, getting actual reply
                if (!data.message.text.endsWith(typingString)) {
                  // when typing finished, this is the end of the message
                  websocket.close(1000, 'Connection closed by client');
                  resolve(data.message.text);
                } else {
                  let actualLength = data.message.text.length - typingString.length;
                  let currentTextTotal = data.message.text.slice(0, actualLength);
                  console.log(`${currentTime()} fetched ${currentTextTotal.length} characters...`);
                }
              }
            }
            else if (data.subtype === 'message_changed') {
              if (editting && !CLAUDE_MEMBER_ID) {
                console.warn("editting is set to true, but you forgot to set `CLAUDE_MEMBER_ID`, are you stupid or something?")
              }
            }
          }
        } catch (error) {
          console.trace(error);
          websocket.close(1000, 'Connection closed by client');
          reject(new Error(error.message + "| " + "getWebSocketResponse: "))
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
    } else {
      // resolve a ReadableStream to stream the websocket's response
      let stream = new ReadableStream({
        start(controller) {
          let currentSlice = 0;
          websocket.on('message', async (message) => {
            try {
              const data = JSON.parse(message);
              // Extract the sender ID from the payload
              if (data.message) {
                let senderId = data.message.user;
                if (data.subtype === 'message_changed' && (!editting || (CLAUDE_MEMBER_ID && senderId === CLAUDE_MEMBER_ID))) {
                  if (messageIndex < prompt.length) {
                    // while context to send still...
                    if (!data.message.text.endsWith(typingString)) {
                      try {
                        await sendNextPrompt();
                      } catch (error) {
                        console.trace(error);
                        throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                      }
                    }
                  } else {
                    // all context sent, getting actual reply
                    if (!data.message.text.endsWith(typingString)) {
                      // when typing finished, this is the end of the message
                      let currentTextChunk = data.message.text.slice(currentSlice);
                      currentSlice = data.message.text.length;
                      console.log("Finished:", data.message.text.length, " characters");
                      currentTextChunk = currentTextChunk.replace(/\*/g, '');
                      controller.enqueue(currentTextChunk);
                      controller.close();
                      websocket.close(1000, 'Connection closed by client');
                    } else {
                      let actualLength = data.message.text.length - typingString.length
                      let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                      currentSlice = actualLength
                      console.log("Sending :", currentTextChunk.length, " characters");
                      currentTextChunk = currentTextChunk.replace(/\*/g, '');
                      controller.enqueue(currentTextChunk);
                    }
                  }
                }
                else if (data.subtype === 'message_changed') {
                  if (editting && !CLAUDE_MEMBER_ID) {
                    console.warn("`editting` is set to true, but you forgot to set `CLAUDE_MEMBER_ID`, are you stupid or something?")
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
