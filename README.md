# Hoping with Slaude
#### Spermack, 3.4-4K Context, Unfiltered Response from Claude
## Changes from Spermack
Spermack is modified so it can only send up to 2 messages to Claude DMs. If the context size exceeds 3,200, It will split <char>, and <scenario>, from <chat>. I tried to add <chat1> and <chat2> and put <chat1> to <char> and <scenario>'s message if it didn't fill the max char count but Claude tends to forget more details due to excessive XML tags to keep track off. Therefore, the chat context can reach up to 3,000 context while still have space for the character and scenario details.


## Claude in Slack Set-Up
1. Register on Slack (https://slack.com) and make a workgroup. If you already have a Slack account, make a new one for this.
2. Add Claude (https://www.anthropic.com/claude-in-slack) to your workgroup.
3. Go to Slack Connect and Create a Pro workspace (30 day trial).
4. Chat Claude on DMs and Accept its Terms of Service.

## Local Proxy Set-Up
1. Pull the Repository or Download the zip from this page.
2. Extract the .zip file and/or Go to the main folder.
3. Open the config.js file in a text editor. You need to change the following values:
- **TOKEN** - In the workspace you created, press F12, go to the network tab (very top of inspect element tabs), once in that tab send a message in any channel, and look for the request starting with chat.postMessage, click it. Click the request(FF)/payload(Chromium) option at the top of the new section, we are looking for a token there starting with xoxc-. Copy it completely(it is the rest of the single line starting with xoxc-) and paste it into *TOKEN*.
- **COOKIE** - Copy the cookies ENCODED in the url. Go to your workspace and press F12. Go to the storage(FF)/application(Chromium) option at the top of the inspect element tab, look for cookies called d, with a value starting with xoxd-. Copy its value completely and paste it into the *COOKIE*.
- **TEAM_ID** - The workspace name you set is the TEAM_ID. In the upper left corner, click on the name of your workspace with a down arrow next to it. There will be a link of your workspace "**(YOUR_TEAM_ID)**.workspace.com", Paste the value into *TEAM_ID*.
- **CLAUDE** - Go to the your DMs with Claude, open the account's info at the top of your chat window and grab the channel ID from the bottom of the new window. We insert it into *CLAUDE*.


## Connecting to SillyTavern
Run start.bat. In the console, you'll see a local IP address (http://127.0.0.1:5004/). Copy it.

In SillyTavern, open OpenAI settings(sliders tab). Select OpenAI Mode and insert the proxy link on "OpenAI / Claude Reverse Proxy".

## SillyTavern Settings
For the Settings for SillyTavern, Click on this [Rentry.](https://rentry.org/slaudehope)

### Credits
- AmmoniaM/Barbiariskaa for Spermack [Barbiariskaa/Spermack](https://github.com/Barbariskaa/Spermack) | [AmmoniaM/Spermack](https://github.com/AmmoniaM/Spermack)
- KaruKaru for XML JB base [JB Rentry](https://rentry.org/karukarubagofgoodies)
- raremew for additional JB [Slaude-fix Rentry](https://rentry.org/znxuz)
- slowburner slaude coper [Slowburn Slaude](rentry.org/hn3bd)
- Anon#96345620