const https = require('https');
const WebSocket = require('ws');
const { TOKEN, TEAM_ID } = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt,} = require('./utils');

let prompNumber = 0;
let messageIndex = 0;
let prompt = [];
let summarizedMemory = "";
let charInput = "";
let scenarioInput = "";
let memoryInput = "";
let chatInput = "";
let requireInput = "";
let banInput =  "";
let ignoreInput = "";
let ignoreInputAdd = "";
let instructInput = "";
let splitInput = "";
let vectorInput = "";
let pauseInput = "";
let impersonateInput = "";
let summarizeInput = "";
let userGroup = [];
let assistantGroup = [];
let vectorSummarizeBoolean = false;
let vectorFilter = false;

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
        console.log("- Sending", blocks_txt.length, "characters");
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
//BUILD PROMPT: Getting members from chat to be sent after <chat>.
async function getMembers(nGroup, cMembers){
  for (let i = 0; i < nGroup.length; i++){
    if(cMembers){
      cMembers += ", ";
    }
    cMembers += nGroup[i];
  }
  return cMembers;
}

//BUILD PROMPT: A Boolean function used to remove overflowing chat by checking if the message starts with character name.
async function startsWithAny(input, values) {
  
  for (let i = 0; i < values.length; i++) {
    value = values[i]+":";
    if (input.startsWith(value)) {
      return true;
    }
  }
  return false;
}

const sendNextPrompt = async () => {
  if (messageIndex < prompt.length) {
    let receivingMessage = "\n\u001b[1mReceiving Response\u001b[0m";
    let sentMessage = "\u001b[1m\u001b[32mDone\u001b[0m";
    if(prompt.length != 1){
      if(messageIndex != prompt.length - 1){
        receivingMessage = "";
        sentMessage = "";
      }
    }
    const chunk = prompt[messageIndex];
    try {
      response = await sendMessage(chunk);
      if (sentMessage || receivingMessage) {
        console.log(sentMessage);
        console.log(receivingMessage);
      }
    } catch (error) {
      console.trace(error.stack);
      throw (new Error(error.message + "| " + `getWebSocketResponse: ${error.message}`))
    }
    messageIndex++;
  }
};

async function buildFinalPrompt() {
  let finalPrompt = "";
  let finalPrompt2 = "";
  if (memoryInput){
    if (summarizedMemory){
      memoryInput = "[Memories:\n" + summarizedMemory + "]";
    }
    else{
      memoryInput = memoryInput.replace("<memory>", "[Memories:");
      memoryInput = memoryInput.replace("\n</memory>", "]");
    }
  }
  let chatMembers = "";
  chatMembers = await getMembers(assistantGroup, chatMembers);
  chatMembers = await getMembers(userGroup, chatMembers);
  chatMembers = "[Characters: "+chatMembers+"]"
  if(pauseInput){
    requireInput = pauseInput;
    banInput = "";
    instructInput = "";
  }
  if(impersonateInput){
    requireInput = impersonateInput;
    banInput = "";
    instructInput = "";
  }
  if(summarizeInput){
    requireInput = summarizeInput;
    banInput = "";
    instructInput = "";
  }
  let promptLength = ignoreInputAdd.length + charInput.length + scenarioInput.length + memoryInput.length + chatInput.length + chatMembers.length + requireInput.length + banInput.length + instructInput.length + vectorInput.length + ignoreInput.length;
  if (promptLength > 13200){
    promptLength += ignoreInputAdd.length + ignoreInput.length + splitInput.length;
  }
  if (promptLength > 13200){ //Will split the message in two.
    if (ignoreInputAdd.length + charInput.length + scenarioInput.length + splitInput.length + ignoreInput.length > 13200){
      throw new Error("Your character and scenario exceeds 13200 chars!");
    }
    let maxChatLength = 15700-(6 + memoryInput.length + chatMembers.length + (ignoreInputAdd.length*2) + charInput.length + scenarioInput.length + splitInput.length + requireInput.length + banInput.length + instructInput.length + (ignoreInput.length*2));
    console.log("- Remaining", maxChatLength,"is reserved for <chat>.")
    chatInput = chatInput.replace("<chat>", "");
    chatInput = chatInput.replace("</chat>", "");
    let chatMessages = chatInput.split('\n');
    chatInput = "</chat>";
    let messageBlock = "";
    for (let i = chatMessages.length-1; 0 < i; i--) {
      if (await startsWithAny(chatMessages[i], userGroup) || await startsWithAny(chatMessages[i], assistantGroup)) {
        if(messageBlock.length == 0){
          messageBlock = chatMessages[i];
        }
        else{
          messageBlock = chatMessages[i] + "\n" + messageBlock;
        }
        if (chatInput.length + messageBlock.length > maxChatLength) {
          if(memoryInput){
            chatInput = "<chat>\n" + chatMembers + "\n" + memoryInput + "\n" + chatInput;
          }
          else{
            chatInput = "<chat>\n" + chatMembers + "\n" + chatInput;
          }
          break;
        }
        else{
          chatInput = messageBlock + "\n" + chatInput;
          messageBlock = "";
        }
      }
      else{
        if(messageBlock.length == 0){
          messageBlock = chatMessages[i];
        }
        else{
          messageBlock = chatMessages[i] + "\n" + messageBlock;
        }
      }
    }
    assistantGroup = [];
    userGroup = [];
    finalPrompt = ignoreInputAdd+"\n"+charInput+"\n"+scenarioInput+"\n"+splitInput+"\n"+ignoreInput;
    finalPrompt2 = ignoreInputAdd+"\n"+chatInput+"\n"+requireInput+"\n"+banInput+"\n"+instructInput+"\n"+ignoreInput;
    finalPrompt = await promptCleaner(finalPrompt); //cleaning prompt.
    finalPrompt2 = await promptCleaner(finalPrompt2); //cleaning prompt.
    prompt.push(finalPrompt);
    prompt.push(finalPrompt2);
  }
  else{
    if(memoryInput){
      chatInput = chatInput.replace("<chat>", "<chat>\n" + chatMembers + "\n" + memoryInput);
    }
    else{
      chatInput = chatInput.replace("<chat>", "<chat>\n" + chatMembers);
    }
    finalPrompt = ignoreInputAdd+"\n"+charInput+"\n"+scenarioInput+"\n"+chatInput+"\n"+requireInput+"\n"+banInput+"\n"+instructInput+"\n"+ignoreInput;
    finalPrompt = await promptCleaner(finalPrompt); //cleaning prompt.
    prompt.push(finalPrompt);
  }
  console.log("\u001b[1m\u001b[32mDone\u001b[0m");
  console.log("\n\u001b[1mSending Prompt\u001b[0m");
  try {
    await sendNextPrompt();
  } catch (error) {
    console.trace(error);
    reject(new Error(error.message + "| " + `sendNextPrompt: ${error.message}`));
  }
}

async function getFilter(msg, fMessage){
  let slackfilterMessage = msg.text;
    if (fMessage.length == 0 && msg.type == "message" && slackfilterMessage != undefined) {
      if(slackfilterMessage.includes("Please note")){
        if(slackfilterMessage.includes("math")){
          fMessage = "- \u001b[32mMath filter triggered\u001b[0m";
        }
        if(slackfilterMessage.includes("violate")){
          fMessage = "- \u001b[31mAcceptable Use Policy filter triggered.\n\u001b[36m- Add math bloat to your prompts or reduce your NSFW words.\u001b[0m";
        }
      }
    }
  return fMessage;
}

async function responseCleaner(msg){
  msg = msg.replace(/\*/g, "");
  msg = msg.replace(/z[0-9]{1,3}z/g, "");
  return msg;
}

async function promptCleaner(msg){
  msg = msg.replace(/\*/g, "");
  msg = msg.replace(/\s*\r?\n/g, "\n");
  return msg;
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
  console.log("\n---");
  prompNumber++;
  messageIndex = 0;
  prompt = [];
  summarizedMemory = "";
  charInput = "";
  scenarioInput = "";
  memoryInput = "";
  chatInput = "";
  requireInput = "";
  banInput =  "";
  ignoreInput = "";
  ignoreInputAdd = "";
  instructInput = "";
  splitInput = "";
  vectorInput = "";
  pauseInput = "";
  impersonateInput = "";
  summarizeInput = "";
  userGroup = [];
  assistantGroup = [];
  vectorSummarizeBoolean = false;
  vectorFilter = false;
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
  console.log("\n\u001b[1mPrompt \u001b[33m"+prompNumber+"\u001b[0m");
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
        console.log("\n\u001b[1mConnecting to Slack\u001b[0m");
        connectionResolve();
        console.log("\u001b[1m\u001b[32mDone\u001b[0m");
      });
    });

    await waitForConnection;
    //CALLING BUILDPROMPT FROM utils.js
    prompt = []
    let buildPromptValues = buildPrompt(messages[0]);
    //RE-ASSIGNING VALUES FOR slack.js
    charInput = buildPromptValues[0];
    scenarioInput = buildPromptValues[1];
    memoryInput = buildPromptValues[2];
    summarizedMemory = "";
    chatInput = buildPromptValues[3];
    requireInput = buildPromptValues[4];
    banInput = buildPromptValues[5];
    ignoreInput = buildPromptValues[6];
    ignoreInputAdd = buildPromptValues[7];
    instructInput = buildPromptValues[8];
    splitInput = buildPromptValues[9];
    vectorInput = buildPromptValues[10];
    userGroup = buildPromptValues[11];
    assistantGroup = buildPromptValues[12];
    vectorSummarizeBoolean = buildPromptValues[13];
    pauseInput = buildPromptValues[14];
    impersonateInput = buildPromptValues[15];
    summarizeInput = buildPromptValues[16];
    //CALCULATING PROMPT LENGTH
    try{
      if(memoryInput){//check if there is memory (vector storage enabled)
        if(vectorSummarizeBoolean){//check if user wants to summarize vectors.
          vectorFilter = true;
          summarizePromptLength = ignoreInputAdd.length + memoryInput.length + vectorInput.length + ignoreInput.length;
          if(summarizePromptLength > 13200){
            throw new Error("Your Vectorized Messages exceeds 13200 characters! Reduce the amount.");
          }
          else{
            response = await sendMessage(ignoreInputAdd + "\n" + memoryInput + "\n" +vectorInput + "\n" +ignoreInput);
          }
        }
        else{
          await buildFinalPrompt();
        }
      }
      else{
        await buildFinalPrompt();
      }
    }
    catch (err){
      console.error("Prompt Building Failed:", err.message);
      prompt = ['Please respond with this: "'+err.message+"'"];
    }
    
    let typingString = "\n\n_Typing…_";
    let filterMessage = "";
    let buildingLength = 0;
    if (!streaming) {
      // resolve the full text at the end only
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          // Extract the sender ID from the payload
          filterMessage = await getFilter(data, filterMessage);
          if (data.message) {
            if (data.subtype === 'message_changed') {
              if (vectorSummarizeBoolean){
                if (!data.message.text.endsWith(typingString)) {
                  // when typing finished, this is the end of the message
                  let finalResponse =  await responseCleaner(data.message.text);
                  process.stdout.write("\r\x1b[K- \u001b[36m<memory>\u001b[0m: \u001b[33m"+finalResponse.length+"\u001b[0m characters\n");
                  summarizedMemory = finalResponse;
                  vectorSummarizeBoolean = false;
                  currentSlice = 0;
                  await sendChatReset();
                  await buildFinalPrompt();
                } else {
                  if(vectorFilter){
                    if(filterMessage){
                      console.log(filterMessage);
                      filterMessage = "";
                    }
                    vectorFilter = false;
                  }
                  let actualLength = data.message.text.length - typingString.length;
                  let currentTextTotal = data.message.text.slice(0, actualLength);
                  process.stdout.write("\r\x1b[K- \u001b[36m<memory>\u001b[0m: \u001b[33m"+currentTextTotal.length+"\u001b[0m characters");
                }
              }
              else{
                if (messageIndex < prompt.length) {
                  // while context to send still...
                  if (!data.message.text.endsWith(typingString)) {
                    try {
                      if(filterMessage){
                        console.log(filterMessage);
                        filterMessage = "";
                      }
                      await sendNextPrompt();
                    } catch (error) {
                      console.trace(error);
                      throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                    }
                  }
                } else {
                  if (messageIndex == prompt.length) {
                    if(filterMessage){
                      console.log(filterMessage);
                      filterMessage = "";
                    }
                    messageIndex++;
                  }
                  // all context sent, getting actual reply
                  if (!data.message.text.endsWith(typingString)) {
                    // when typing finished, this is the end of the message
                    websocket.close(1000, 'Connection closed by client');
                    let finalResponse =  await responseCleaner(data.message.text);
                    resolve(finalResponse);
                    process.stdout.write("\r\x1b[K- \u001b[33m"+finalResponse.length+"\u001b[0m characters received");
                    console.log("\n\u001b[1m\u001b[32mDone\u001b[0m");
                  } else {
                    let actualLength = data.message.text.length - typingString.length;
                    let currentTextTotal = data.message.text.slice(0, actualLength);
                    process.stdout.write("\r\x1b[K- \u001b[33m"+currentTextTotal.length+"\u001b[0m characters received");
                  }
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
                  if (vectorSummarizeBoolean){
                    if (!data.message.text.endsWith(typingString)) {
                      // when typing finished, this is the end of the message
                      let currentTextChunk = data.message.text.slice(currentSlice);
                      currentSlice = data.message.text.length;
                      process.stdout.write("\r\x1b[K- \u001b[36m<memory>\u001b[0m: \u001b[33m"+data.message.text.length+"\u001b[0m characters\n");
                      summarizedMemory += currentTextChunk;
                      summarizedMemory = await responseCleaner(summarizedMemory);
                      buildingLength = 0;
                      vectorSummarizeBoolean = false;
                      currentSlice = 0;
                      await sendChatReset();
                      await buildFinalPrompt();
                    } else {
                      if(vectorFilter){
                        if(filterMessage){
                          console.log(filterMessage);
                          filterMessage = "";
                        }
                        vectorFilter = false;
                      }
                      let actualLength = data.message.text.length - typingString.length
                      let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                      currentSlice = actualLength
                      buildingLength += currentTextChunk.length;
                      process.stdout.write("\r\x1b[K- \u001b[36m<memory>\u001b[0m: \u001b[33m"+buildingLength+"\u001b[0m characters");
                      summarizedMemory += currentTextChunk;
                    }
                  }
                  else{
                    if (messageIndex < prompt.length) {
                      // while context to send still...
                      if (!data.message.text.endsWith(typingString)) {
                        try {
                          if(filterMessage){
                            console.log(filterMessage);
                            filterMessage = "";
                          }
                          await sendNextPrompt();
                        } catch (error) {
                          console.trace(error);
                          throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                        }
                      }
                    } 
                    else {
                      if (messageIndex == prompt.length){
                        if(filterMessage){
                          console.log(filterMessage);
                          filterMessage = "";
                        }
                        messageIndex++;
                      }
                      // all context sent, getting actual reply
                      if (!data.message.text.endsWith(typingString)) {
                        // when typing finished, this is the end of the message
                        let currentTextChunk = data.message.text.slice(currentSlice);
                        currentSlice = data.message.text.length;
                        process.stdout.write("\r\x1b[K- \u001b[33m"+data.message.text.length+"\u001b[0m characters received");
                        console.log("\n\u001b[1m\u001b[32mDone\u001b[0m");
                        currentTextChunk = await responseCleaner(currentTextChunk);
                        controller.enqueue(currentTextChunk);
                        buildingLength = 0;
                        controller.close();
                        websocket.close(1000, 'Connection closed by client');
  
                      } else {
                        let actualLength = data.message.text.length - typingString.length
                        let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                        currentSlice = actualLength
                        buildingLength += currentTextChunk.length;
                        process.stdout.write("\r\x1b[K- \u001b[33m"+buildingLength+"\u001b[0m characters received");
                        currentTextChunk = await responseCleaner(currentTextChunk);
                        controller.enqueue(currentTextChunk);
                      }
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