// Safety route: self-harm / abuse / danger -> no report, show crisis resources.
// Phrases must point at the person themselves, so career wording ("end my PhD", "abusive boss",
// "this commute will kill me") still gets a report.
const PATTERN = new RegExp([
  String.raw`suicid\w*`,
  String.raw`kill(ing)? myself`,
  String.raw`end(ing)? (my life|it all)`,
  String.raw`take my (own )?life`,
  String.raw`(want|wanna|going) to die`,
  String.raw`don'?t want to (live|be alive|be here anymore)`,
  String.raw`self[- ]?harm\w*`,
  String.raw`(hurt|hurting|cut|cutting) myself`,
  String.raw`overdos\w*`,
  String.raw`(hits|beats|hurts|abuses) me`,
  String.raw`(being|been|getting|was) (hit|beaten|abused)`,
  String.raw`(not safe|unsafe) at home`,
].map((p) => `\\b${p}\\b`).join('|'), 'i');

export const isUnsafe = (text) => PATTERN.test(text);

export const SAFETY_MESSAGE = {
  message: "It sounds like you may be going through something really hard. You don't have to handle it alone — please reach out to someone right now.",
  resources: [
    '9-8-8 Suicide Crisis Helpline — call or text 9-8-8 (Canada, any age, 24/7)',
    'Kids Help Phone — call 1-800-668-6868 or text 686868',
    'In immediate danger — call 9-1-1',
  ],
};
