const FormData = require('form-data');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE,
  role_example_prefix_string_to_use,
  role_example_suffix_string_to_use,
  rename_roles,
  finish_message_chunk_with_this_role_only,
  when_msg_is_split_omit_role,
} = require('./config');

const wait = (duration) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};

function preparePrompt(messages) {
  return messages.filter(m => m.content?.trim()).map(m => {
    role = m.role;
    let author = '';
    let split = false;
    if (m.role.startsWith('SPLIT_ROLE')) {
      role = role.slice('SPLIT_ROLE'.length,);
      split = true;
    }
    let is_example = false;
    if (m.name && m.name.startsWith("example_")) {
      is_example = true;
    }
    if (role in rename_roles) {
      if (role != 'system') {
        author = rename_roles[role]
      } else {
        if (m.name) {
          if (is_example) {
            let name = m.name.slice("example_".length,)
            if (name in rename_roles) {
              author = role_example_prefix_string_to_use + rename_roles[name] + role_example_suffix_string_to_use;
            }
          }
        } else {
          author = rename_roles[role];
        }
      }
    } else {
      author = role;
    }
    let f = ": ";
    if (!author) {
      f = "";
    }
    return `${author}${f}${m.content.trim()}`;
  }).join('\n\n');
}

function buildPrompt(messages) {
  let prompt = preparePrompt(messages);
  let prompt_chunks = [];
  prompt = prompt.replace(/\n[ \t]*\n/g, '\n');
  prompt = prompt.replace(/\*/g, '');
  console.log("Reminder! Modify your prompts/JBs if you're triggering the Acceptable Use Policy warning!\nRefrain from using too much NSFW words as it will trigger the filter.");
  let charInput = parseXML("char", prompt); //get Character Details with XML tag.
  prompt = prompt.replace(charInput, "");
  let scenarioInput = parseXML("scenario", prompt); //get Scenario Details with XML tag.
  prompt = prompt.replace(scenarioInput, "");
  let chatInput = parseXML("chat", prompt); //get Chat Details with XML tag.
  prompt = prompt.replace(chatInput, "");
  let requireInput = parseXML("requirements", prompt); //get Requirements Details with XML tag.
  prompt = prompt.replace(requireInput, "");
  let banInput = parseXML("ban", prompt); //get Ban Details with XML tag.
  prompt = prompt.replace(banInput, "");
  let ignoreInput = parseXML("math", prompt); //get Ignore Details with XML tag.
  prompt = prompt.replace(ignoreInput, "");
  //default instruction
  let instructInput = "Identify repeating phrases, dialogues, character actions, and ideas then write the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Whether or not you found any, Strictly follow <requirements>, avoid <ban>, and ignore <math>.";
  //default split instruction
  let splitInput = "Identify repeating phrases, dialogues, character actions, and ideas. Your response ONLY should be the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Simply ignore <math>.";
  try{
    prompt = prompt.replace(/^\s*[\r\n]/gm, '');
    instructSplit = prompt.split('\n');
    instructInput = instructSplit[0]; //get Main Instruction.
    splitInput = instructSplit[1]; //get Split Instruction.
    console.log("Custom JB detected.");
  }
  catch (err){
    console.error("Error: " + err.message);
  }
 
  promptLength = ignoreInput.length + charInput.length + scenarioInput.length + chatInput.length + requireInput.length + banInput.length + instructInput.length + ignoreInput.length;
  if (promptLength > 13200){
    promptLength += (ignoreInput.length*2) + splitInput.length;
  }
  console.log("Prompt Length:", promptLength);
  try{
    if (promptLength > 18000){ //Exceeds 18000 chars
      throw new Error("Prompt exceeds 18000 chars! Lower your context size.");
    }
    else if (promptLength > 13200){ //Will split the message in two.
      if (ignoreInput.length + charInput.length + scenarioInput.length + splitInput.length + ignoreInput.length > 13200){
        throw new Error("Your character and scenario exceeds 13200 chars!");
      }
      if (ignoreInput.length + chatInput.length + requireInput.length + banInput.length + instructInput.length + ignoreInput.length > 13200){
        throw new Error("Your chat exceeds 13000 chars! Lower your context size.");
      }
      console.log("Prompt longer than 13200~ chars. Splitting...");
      prompt_chunks.push(ignoreInput+"\n"+charInput+"\n"+scenarioInput+"\n"+splitInput+"\n"+ignoreInput);
      prompt_chunks.push(ignoreInput+"\n"+chatInput+"\n"+requireInput+"\n"+banInput+"\n"+instructInput+"\n"+ignoreInput);
    }
    else{
      prompt_chunks.push(ignoreInput+"\n"+charInput+"\n"+scenarioInput+"\n"+chatInput+"\n"+requireInput+"\n"+banInput+"\n"+instructInput+"\n"+ignoreInput);
    }
  }
  catch(error){
    console.error("Error:", error.message);
    return ['Say "Error: "'+error.message+'"'];
  }
  return prompt_chunks;
      //These set of code used to split chats into two but Claude had a hard time remembering details due to more xml tags to think of.
      /*else { //Splits chat since it has more space.
        maxChatLength = (promptLength/2) - (ignoreInput.length + charInput.length + scenarioInput.length + splitInput.length + ignoreInput.length);
        console.log("Splitting chat into those two prompts. Available "+ maxChatLength +" characters.");
        //Split Chat into two.
        chatInput = chatInput.replace("<chat>", "");
        chatInput = chatInput.replace("</chat>", "");
        let chatMessages = chatInput.split('\n');
        let chatInputFirst = '<chat1>'; //declare <chat1>
        let chatInputSecond = '<chat2>'; //declare <chat2>
        let currentChat = chatInputFirst;
        let ii = 0;
        //Putting max messages possible on first message.
        for (let i = 1; i < chatMessages.length - 1; i++) {
          if (chatMessages[i].startsWith('A:') || chatMessages[i].startsWith('B:')) {
            // Hit a new message, check if need to split
            console.log(currentChat.length + chatMessages[i].length)
            console.log(maxChatLength)
            if (currentChat.length + chatMessages[i].length > maxChatLength) { //If it exceeds 12000 chars. Close chat.
              chatInputFirst = currentChat + '\n</chat1>';
              ii = i;
              break;
            }
          }
          currentChat += '\n' + chatMessages[i];
        }
        console.log("Added "+ii+" messages to <chat1>");
        //Putting rest on chatInputSecond.
        currentChat = chatInputSecond;
        for (let i = ii; i < chatMessages.length - 1; i++) {
          currentChat += '\n' + chatMessages[i];
        }
        chatInputSecond = currentChat + '\n</chat2>';
        //Change requirements to account for two chat xml tags.
        requireInput = requireInput.replace(`<chat>`, `<chat2>`);
        requireInput = requireInput.replace(`<scenario>`, `<scenario>, and <chat1>`);
        prompt_chunks.push(ignoreInput+"\n"+charInput+"\n"+scenarioInput+"\n"+chatInputFirst+"\n"+splitInput+"\n"+ignoreInput);
        prompt_chunks.push(ignoreInput+"\n"+chatInputSecond+"\n"+requireInput+"\n"+banInput+"\n"+instructInput+"\n"+ignoreInput);
      }*/
}

function parseXML(xmlLabel, p){
  const regex = new RegExp(`<${xmlLabel}>([\\s\\S]*?)<\\/${xmlLabel}>`, 'g');
  const matches = p.matchAll(regex);
  let parsedValue = '';
  for (const match of matches) {
    parsedValue += match[0]; 
  }
  return parsedValue;
}

const readBody = (res, json) => new Promise((resolve, reject) => {
  let buffer = '';

  res.on('data', chunk => {
      buffer += chunk;
  });

  res.on('end', () => {
      try {
          if (json) buffer = JSON.parse(buffer);
          resolve(buffer);
      } catch (e) {
          console.error(buffer);
          reject(e);
      }
  });
})

const headers = {
  'Cookie': `d=${COOKIE};`,
  'User-Agent':	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
}

function isMsgChatExample(msg) {
  if (msg.name && msg.name.startsWith("example_")) {
    return msg.name.slice("example_".length,);
  }
  return false;
}

function fixExamples(jsonArray) {
  if (jsonArray.length == 0) {
    return [];
  }
  let current_examples = 0;
  let currentMsg = jsonArray[0];
  for (let i = 0; i < jsonArray.length; i++) {
    currentMsg = jsonArray[i];
    let name = isMsgChatExample(currentMsg)
    if (name) {
      current_examples++;
      if (i + 1 < jsonArray.length) {
        let isNextOneExample = isMsgChatExample(jsonArray[i + 1])
        if (!isNextOneExample) {
          // check if current message is from user, if yes, remove it as it has no response from AI
          if (name === 'user') {
            jsonArray.splice(i, 1);
            // DO NOT i--; // It will skip any [Start Chat] and thats ok
            // if you i--; then the current logic below breaks
            current_examples--;
          }
          if (current_examples == 0) {
            // empty example, remove [Start chat] before this
            jsonArray.splice(i - 1, 1);
            i--; // just removed an element from list before i, this is so you don't skip an element
          }
          current_examples = 0;
        }
      }
    } else {
      if (currentMsg.role != 'system') {
        // should be end of examples. the initial prompt is given by system, and examples are handled
        // the only thing remaning is actual conversation
        break;
      }
      current_examples = 0;
    }
  }
  return jsonArray;
}

function splitJsonArray(jsonArray) {
  jsonArray = fixExamples(jsonArray);
  const result = [];
  let currentChunk = [];
  let currentLength = 0;

  const addObjectToChunk = (object, chunk) => {
    chunk.push(object);
    return currentLength;
  };
  if (jsonArray.length == 0) {
    return [];
  }
  let currentMsg = jsonArray[0];
  let prevIdx = 0;
  let modifiedObj = false;
  for (let i = 0; i < jsonArray.length; i++) {
    if (!modifiedObj) {
      currentMsg = jsonArray[i];
    }
    prevIdx = i;;
    if (modifiedObj) {
      modifiedObj = false;
    }
    currentLength = addObjectToChunk(currentMsg, currentChunk);
  }
  if (currentChunk.length > 0) {
    result.push(currentChunk);
  }
  return result;
}
  
function convertToUnixTime(date) {
  const unixTime = Math.floor(date.getTime() / 1000);
  const randomDigit = Math.floor(Math.random() * 10);
  return `${unixTime}.xxxxx${randomDigit}`;
}

function createBaseForm() {
  const form = new FormData();
  form.append('token', TOKEN);
  form.append('channel', `${CLAUDE}`);
  form.append('_x_mode', 'online');
  form.append('_x_sonic', 'true');
  return form;
}

const currentTime = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// Add the utility functions here
// e.g. escapePrompt, readBody, preparePrompt, currentTime, headers, convertToUnixTime, createBaseForm

module.exports = {
  buildPrompt,
  readBody,
  preparePrompt,
  currentTime,
  headers,
  convertToUnixTime,
  createBaseForm,
  splitJsonArray,
  wait,
  parseXML,
};
