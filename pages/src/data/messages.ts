/**
 * Personal messages from Kayla's dad, threaded into the app.
 *
 * Two pools:
 *   - WELCOME_MESSAGES appear on the PIN gate, one at a time.
 *   - THINKING_MESSAGES rotate while the tutor is composing a reply.
 *
 * Selection is random. Each instance picks one message; the thinking
 * indicator rotates to a new random message every 12-18 seconds.
 *
 * To add or change messages, edit the arrays below. No backend or
 * database change required. Rebuild the frontend after editing.
 *
 * Style note: keep messages short (under 60 chars when possible).
 * Always "Kayla," never "Kay."
 */

/* eslint-disable -- message strings use double quotes intentionally so the source matches the operator's input verbatim. */

export const WELCOME_MESSAGES: readonly string[] = [
  "I love you, Kayla",
  "I'm rooting for you",
  "Let's do this",
  "This is a huge step for you",
  "You belong here",
  "I'm here. Always",
  "I'm so glad you're mine",
  "Pride doesn't begin to cover it",
  "I love how hard you try",
  "I'm cheering for you, Kayla",
  "I love you more than you know",
  "You're in the right place",
  "I made this because I believe in you",
  "Three weeks of this and you'll be unstoppable",
  "I'd be proud of you no matter what",
];

export const THINKING_MESSAGES: readonly string[] = [
  "You are a smart girl",
  "Math isn't the only thing you're good at",
  "You're smarter than you think",
  "Take a breath",
  "Remember to listen again, and again",
  "You got this",
  "I see you working hard",
  "You're putting in the time",
  "You're doing great",
  "I'm proud of you, Kayla",
  "You showed up. That's the hardest part",
  "One question at a time",
  "Future you is going to thank you",
  "Trust yourself",
  "Don't rush. Just think",
  "Read it again. It'll come",
  "Slow is smooth. Smooth is fast",
  "Look how far you've come",
  "You're enough, Kayla. You always have been",
  "This isn't easy. You're doing it anyway",
  "You can do hard things",
  "Keep your head up",
  "I love watching you grow",
  "Every minute you study counts",
  "The exam doesn't define you",
  "You're working harder than you know",
  "Be patient with yourself",
  "You don't have to be perfect",
  "Just keep going",
  "Your brain is incredible",
  "Stay with it",
  "You're going to look back on this and smile",
  "Confidence comes from doing",
  "Think it through. You'll see it",
  "There's no rush",
  "You got this, kid",
  "Even your questions are smart",
  "Show yourself some grace",
  "You're allowed to take your time",
  "Mistakes are part of it",
  "Don't quit on yourself",
  "Pause if you need to",
  "You're not alone in this",
  "Look up. You're doing it",
  "Hard work always shows up later",
  "You're tougher than this exam",
  "Keep showing up",
  "Brick by brick",
  "Don't let one question shake you",
  "You've already done so much",
  "Steady wins",
  "Thinking is the work",
  "You're learning, even when it doesn't feel like it",
  "Be kind to yourself, Kayla",
  "The brain you've got was built for this",
  "Curiosity beats fear every time",
  "One more, then a break if you need",
  "You're more capable than your worst day",
  "I'm proud of who you're becoming",
  "Effort is its own kind of smart",
  "You can pause. The exam can wait",
  "You're built for this kind of work",
  "Reading carefully is half the battle",
  "The version of you that takes this exam will be ready",
  "I love you, Kayla. Always",
];
