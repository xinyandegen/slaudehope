const FormData = require('form-data');

const { TOKEN, COOKIE, CLAUDE } = require('./config');

const wait = (duration) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};

let prompt = "";//setting prompt
let scenarioInput = "";
//default instruction
let instructInput = "Identify repeating phrases, dialogues, character actions, and ideas then write the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Whether or not you found any, Strictly follow <requirements>, avoid <ban>, and ignore <math>.";
//default split instruction
let splitInput = "Identify repeating phrases, dialogues, character actions, and ideas. Your response ONLY should be the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Simply ignore <math>.";
//default vector instruction
let vectorInput = "Identify repeating phrases, dialogues, character actions, and ideas then write the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Whether or not you found any, In 150 to 200 words, In third person, Summarize into one paragraph the information within <memory> which are broken up conversation of {{char}}'s memories. Write as if you're summarizing a story. Don't write less than 150 words or more than 200 words. No OOC comments. Ignore and dismiss <math>.";
let ignoreInput = "";//this will be for <math> bloat.
let ignoreInputAdd = ""; //this will be for when you enable doubleMath.
let userGroup = []; //this will serve if user has multiple personas.
let assistantGroup = []; //this will serve for group chats with multiple character names assigned for assistant.
let vectorSummarizeBoolean = false;

//FIX EXAMPLES: Fixing Quotes
function quoteFix(msg) {
	let doubleQuotes = /^"(.*)"$/;
  let singleQuotes = /^(["'])(.*)\1$/;
  if(doubleQuotes.test(msg)){
     return(msg);
  }
  else if(singleQuotes.test(msg)){
     return(msg.replace("'", '"'));
  }
  else{
     return('"'+msg+'"');
  }
}

//FIX EXAMPLES: Main function of reformatting how example chats are sent.
function fixExamples(jsonArray) {
  let clumpExample = ""
  for (let i = 0; i < jsonArray.length; i++) {
  	if(jsonArray[i].name == "example_assistant"){
      if(clumpExample == ""){
      	clumpExample = "Example Speech:\n"+quoteFix(jsonArray[i].content);
      }
      else{
      	clumpExample = clumpExample + "\n"+ quoteFix(jsonArray[i].content);
      }
    }
  	if(jsonArray[i].name == "example_user"){
    	jsonArray.splice(i, 1);
      i--;
    }
    if(jsonArray[i].role == "system" && jsonArray[i].content == "Example speech:"){
    	jsonArray.splice(i, 1);
      i--;
    }
  }
  if(jsonArray.some(item => item.name === 'example_assistant')){
    let indexSystem = jsonArray.findIndex(item => item.name === 'example_assistant');
    jsonArray[indexSystem].content = clumpExample;
    jsonArray[indexSystem].name = "example_system";
    for (let i = 0; i < jsonArray.length; i++) {
      if(jsonArray[i].name == "example_assistant"){
        jsonArray.splice(i, 1);
        i--;
      }
    }
  }
  return jsonArray;
}

//GET JSON PROMPT: Main function of getting the json from POST and returning in chunks.
function splitJsonArray(jsonArray) {
  if (jsonArray.length == 0) {
    return [];
  }
  jsonArray = fixExamples(jsonArray);
  const result = [];
  let currentChunk = [];
  let currentLength = 0;
  const addObjectToChunk = (object, chunk) => {
    chunk.push(object);
    return currentLength;
  };
  for (let i = 0; i < jsonArray.length; i++) {
    currentLength = addObjectToChunk(jsonArray[i], currentChunk);
  }
  result.push(currentChunk);
  return result;
} 

//BUILD PROMPT: Converting json prompt into a plain text prompt.
function preparePrompt(messages) {
  return messages.filter(m => m.content?.trim()).map(m => {role = m.role;
    let author = "";
    if(m.name) {
      author = m.name.replace("_", " ");
    }
    if(role != "system"){
      if(role == "assistant"){
        if(!assistantGroup.includes(author)){
          assistantGroup.push(author);
        }
      }
      else{
        if(!userGroup.includes(author)){
          userGroup.push(author);
        }
      }
      author = author + ": ";
    }  
    return `${author}${m.content.trim()}`;
  }).join('\n\n');
}

//BUILD PROMPT: Checking if XML tag exists. If it does it will store the value.
function getXML(tagName, p){
  let xmlValue = "";
  xmlValue = parseXML(tagName, p);
  if(xmlValue){
    console.log("- \u001b[36m<"+tagName+">\u001b[0m: \u001b[33m"+xmlValue.length+"\u001b[0m characters")
    prompt = prompt.replace(xmlValue, "");
  }
  return xmlValue;
}

//BUILD PROMPT: Detecting XML tags through regex. It serves getXML the appropriate value of the XML tag.
function parseXML(xmlLabel, p){
  const regex = new RegExp(`<${xmlLabel}>([\\s\\S]*?)<\\/${xmlLabel}>`, 'g');
  const matches = p.matchAll(regex);
  let parsedValue = '';
  for (const match of matches) {
    parsedValue += match[0]; 
  }
  return parsedValue;
}

//BUILD PROMPT: Getting instructions from prompt sent.
function getInstructions(instructList, mInput){
  if(instructList[0] != undefined){//MAIN INSTRUCTION
    instructInput = instructList[0];
    console.log("- \u001b[36mMAIN INSTRUCTION\u001b[0m: \u001b[33m"+instructInput.length+"\u001b[0m characters")
  }
  if(instructList[1] != undefined){//SPLIT INSTRUCTION
    splitInput = instructList[1];
    console.log("- \u001b[36mSPLIT INSTRUCTION\u001b[0m: \u001b[33m"+splitInput.length+"\u001b[0m characters")
  }
  if(instructList[2] != undefined){//VECTOR INSTRUCTION
    vectorInput = instructList[2];
    console.log("- \u001b[36mVECTOR INSTRUCTION\u001b[0m: \u001b[33m"+vectorInput.length+"\u001b[0m characters")
  }
  if(instructList[3] != undefined){//doubleMath
    if(instructList.includes("doubleMath=true")){
      console.log("- \u001b[36mdoubleMath\u001b[0m is \u001b[32menabled\u001b[0m\n- Adding \u001b[36m<math>\u001b[0m at the start and end of the prompt");
      ignoreInputAdd = ignoreInput;
    }
    else{
      if(instructList.includes("doubleMath=false")){
        console.log("- \u001b[36mdoubleMath\u001b[0m is \u001b[33mdisabled\u001b[0m\n- Adding \u001b[36m<math>\u001b[0m only at the end of the prompt");
      }
      else{
        console.log("- \u001b[36mdoubleMath\u001b[0m config is \u001b[33mincorrect\u001b[0m\n- Adding \u001b[36m<math>\u001b[0m only at the end of the prompt");
      }
    }
  }
  else{
    console.log("- \u001b[31mNo \u001b[36mdoubleMath\u001b[0m config found\u001b[0m\n- Adding \u001b[36m<math>\u001b[0m only at the end of the prompt");
  }
  if(mInput){// if there is <memory>
    if(instructList[4] != undefined){//vectorSummarize
      if(instructList.includes("vectorSummarize=true")){
        console.log("- \u001b[36mvectorSummarize\u001b[0m is \u001b[32menabled\u001b[0m\n- Using summarized \u001b[36m<memory>\u001b[0m.");
        vectorSummarizeBoolean = true;
      }
      else{
        if(instructList.includes("vectorSummarize=false")){
          console.log("- \u001b[36mvectorSummarize\u001b[0m is \u001b[33mdisabled\u001b[0m\n- Using \u001b[36m<memory>\u001b[0m without summarizing.");
        }
        else{
          console.log("- \u001b[36mvectorSummarize\u001b[0m config is \u001b[33mincorrect\u001b[0m\n- Using \u001b[36m<memory>\u001b[0m without summarizing.");
        }
      }
    }
    else{
      console.log("- \u001b[31mNo \u001b[36mvectorSummarize\u001b[0m config found\u001b[0m\n- Using \u001b[36m<memory>\u001b[0m without summarizing.");
    }
  }
}

//BUILD PROMPT: Main function of building prompts.
function buildPrompt(messages) {//main process of building the prompt
  try{
    console.log("\n\u001b[1mPreparing Prompt\u001b[0m");
    //RESETTING VALUES
    //default instruction
    instructInput = "Identify repeating phrases, dialogues, character actions, and ideas then write the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Whether or not you found any, Strictly follow <requirements>, avoid <ban>, and ignore <math>.";
    //default split instruction
    splitInput = "Identify repeating phrases, dialogues, character actions, and ideas. Your response ONLY should be the number of repetitions ONCE (e.g. z1z). If you find none, output z0z. Simply ignore <math>.";
    ignoreInput = "";//this will be for <math> bloat.
    scenarioInput = "";//this will be for scenario.
    ignoreInputAdd = ""; //this will be for when you enable doubleMath.
    doubleMathBoolean = false; //this will be the default doubleMath config.
    vectorSummarizeBoolean = false; //this will be the default vectorSummarize config.
    let prompt_chunks = [];//where the prompts will be stored to be sent for slack.
    //START GETTING VALUES
    prompt = preparePrompt(messages);//converting json prompt due to OpenAI formatting to plain text Claude format.
    prompt = prompt.replace(/\n[ \t]*\n/g, '\n');//removing blank newlines.
    prompt = prompt.replace(/\*/g, '');//removing asterisks.
    let charInput = getXML("char", prompt); //get Character Details with XML tag.
    scenarioInput = getXML("scenario", prompt); //get Scenario Details with XML tag.
    let memoryInput = getXML("memory", scenarioInput); //get Memory from Scenario.
    scenarioInput = scenarioInput.replace(memoryInput, ""); //remove Memory from Scenario if it exists.
    let chatInput = getXML("chat", prompt); //get Chat Details with XML tag.
    let requireInput = getXML("requirements", prompt); //get Requirements Details with XML tag.
    let banInput = getXML("ban", prompt); //get Ban Details with XML tag.
    ignoreInput = getXML("math", prompt); //get Ignore Details with XML tag.
    prompt = prompt.replace(/^\s*[\r\n]/gm, '');
    instructSplit = prompt.split('\n'); 
    getInstructions(instructSplit, memoryInput); //get Main Instruction, Split Instruction, Vector Instruction, doubleMath config, vectorSummarize config.
    //PUT VALUES TO ARRAY
    prompt_chunks = [charInput, scenarioInput, memoryInput, chatInput, requireInput, banInput, ignoreInput, ignoreInputAdd, instructInput, splitInput, vectorInput, userGroup, assistantGroup, vectorSummarizeBoolean];
    //RETURN ARRAY
    return prompt_chunks;
  }
  catch (err){
    console.error("Prompt Building Failed:", err.message);
    return ['Please respond with this: "'+err.message+"'"];
  }
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
