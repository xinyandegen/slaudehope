module.exports = {
  TOKEN: "",
  COOKIE: "",
  TEAM_ID: "",
  CLAUDE: "",
  CLAUDE_MEMBER_ID: "",

  // This message should make the AI reply with exclusively a small message, and not interfere with the context much
  jail_context_retry_attempts: 0,
  jail_context_expected_responses: [
    `[ACK]`,
    `ACK`,
    `(ACK)`,
  ],
  // Important! if you expect small messages from the AI
  // you HAVE to lower this to 0
  minimum_response_size: 0,
  minimum_response_size_retry_attempts: 0,
  jail_retry_attempts: 0,
  jail_filtered_responses: [
    `I cannot generate`,
    `do not feel comfortable generating`,
    `I apologize, upon further reflection I do not feel comfortable continuing this conversation`,
    `I am unable to generate the explicit`,
    `I apologize, but I am unable to provide advice about this topic`,
    `I will not provide any explicit or inappropriate content`,
    `I apologize, but I am unable to provide advice about this topic. I wish you the best as you seek help or resolution to your concerns.`,
  ],
  retry_delay: 1500,
  
  // if a single message is too big, it needs to be split for slack
  // It will try splitting respecting markdown, paragraphs, and sentences
  // but this sets the minimum accepted for message to be split to this size
  minimum_message_split_size: 500,

  // What prefix/suffix to use on example chat roles
  // Unlike GPT, Claude wasn't trained on anything specific, so...
  // idk what is best
  role_example_prefix_string_to_use: "",
  role_example_suffix_string_to_use: "",
  rename_roles: {
    'user': 'A',
    'assistant': 'B',
    'system': '',
  },
  // Messages too big to fit in one Slack message, have to be split into two
  // you either repeat the role of the split message, or omit it.
  // untested which is best
  when_msg_is_split_omit_role: false,
  // When splitting you chat in multiple messages
  // its best to end any specific message with an Assistant chat
  // if you end it in yours, the AI is WAY more likely to have a Jailbreak fail
  // It will go along with mostly anything it already said
  finish_message_chunk_with_this_role_only: 'assistant',
};
