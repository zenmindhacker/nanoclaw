
// Dark feminine & mystic quotes — rotating daily
const DARK_FEMININE_QUOTES = [
  // Clarisse Lispector
  { text: "I am not afraid of the dark. I am the dark.", author: "Clarisse Lispector" },
  { text: "Everything in the world began with a yes. One molecule said yes to another molecule and life was born.", author: "Clarisse Lispector" },
  { text: "Hell is not burning ashes. Hell is full of cold.", author: "Clarisse Lispector" },
  { text: "She had been born for greatness — or for error. She could only reach the first through the second.", author: "Clarisse Lispector" },
  { text: "I do not know many things. But there are things that I know and the plants know and the water knows.", author: "Clarisse Lispector" },
  // Kasia Urbaniak
  { text: "Power is the ability to affect your environment. Desire is the compass.", author: "Kasia Urbaniak" },
  { text: "The one who asks the questions holds the power.", author: "Kasia Urbaniak" },
  { text: "Submission without choice is oppression. Submission with choice is art.", author: "Kasia Urbaniak" },
  { text: "Women are trained to give answers. Powerful women ask questions.", author: "Kasia Urbaniak" },
  // Teal Swan
  { text: "The wound is where the light enters you.", author: "Teal Swan" },
  { text: "You cannot selectively numb emotion. If you numb the dark, you numb the light.", author: "Teal Swan" },
  { text: "Integration is not about destroying what is unwanted. It is about lovingly including it.", author: "Teal Swan" },
  { text: "You are the universe experiencing itself through the aperture of your senses.", author: "Teal Swan" },
  // Joan Didion
  { text: "I write entirely to find out what I am thinking, what I am looking at, what I see and what it means.", author: "Joan Didion" },
  { text: "We tell ourselves stories in order to live.", author: "Joan Didion" },
  { text: "Character — the willingness to accept responsibility for one's own life — is the source from which self-respect springs.", author: "Joan Didion" },
  { text: "To free us from the expectations of others, to give us back to ourselves — there lies the great, the singular power of self-respect.", author: "Joan Didion" },
  // Anais Nin
  { text: "And the day came when the risk to remain tight in a bud was more painful than the risk it took to blossom.", author: "Anais Nin" },
  { text: "I must be a mermaid. I have no fear of depths and a great fear of shallow living.", author: "Anais Nin" },
  { text: "We do not grow absolutely, chronologically. We grow sometimes in one dimension, and not in another; unevenly.", author: "Anais Nin" },
  // Rumi (mystic)
  { text: "The wound is the place where the Light enters you.", author: "Rumi" },
  { text: "Do not be satisfied with the stories that come before you. Unfold your own myth.", author: "Rumi" },
  { text: "Let yourself be silently drawn by the strange pull of what you really love. It will not lead you astray.", author: "Rumi" },
  // Mary Oliver
  { text: "Tell me, what is it you plan to do with your one wild and precious life.", author: "Mary Oliver" },
  { text: "Someone I loved once gave me a box full of darkness. It took me years to understand that this too, was a gift.", author: "Mary Oliver" },
  // Adrienne Rich
  { text: "The woman I needed to call my mother was silenced before I was born.", author: "Adrienne Rich" },
  { text: "When a woman tells the truth she is creating the possibility for more truth around her.", author: "Adrienne Rich" },
];

// Tantric sutras (from Vigyan Bhairav Tantra) — rotating daily
const TANTRIC_SUTRAS = [
  "Radiant one, this experience may dawn between two breaths. After breath comes in and just before turning up — the beneficence.",
  "Or, whenever in-breath and out-breath fuse, at this instant touch the energy-less, energy-filled center.",
  "Or, when breath is all out and stopped of itself, or all in and stopped — in such universal pause, one's small self vanishes.",
  "Consider your essence as light rays from center to center up the vertebrae, and so rises livingness in you.",
  "Or in the spaces between, feel this as lightning.",
  "Feel the cosmos as a translucent ever-living presence.",
  "In summer when you see the entire sky endlessly clear, enter such clarity.",
  "Suppose you contemplate something beyond perception, beyond grasping, beyond not being — you.",
  "At the edge of a deep well look steadily into its depths until — the wondrousness.",
  "Wherever your attention alights, at this very point, experience.",
  "When a mood against someone or for someone arises, do not place it on the person in question, but remain centered.",
  "Just as you have the impulse to do something, stop.",
  "Lie down as dead. Enraged in wrath, stay so. Or stare without moving an eyelash.",
  "Devotion frees.",
  "Roam about until exhausted and then, dropping to the ground, in this dropping be whole.",
  "At the point of sleep, when sleep has not yet come and wakefulness vanishes, at this point being is revealed.",
  "In rain during a dark night, enter that blackness as the form of forms.",
  "When a moonless rainy night is not present, close your eyes and find blackness before you. Opening eyes, see blackness. So faults disappear forever.",
  "Gracious one, play. The universe is an empty shell wherein your mind frolics infinitely.",
  "Look upon a bowl without seeing the sides or the material. In a few moments become aware.",
];

function getDailyQuote(dateStr) {
  const dayOfYear = Math.floor((new Date(dateStr) - new Date(dateStr.split('-')[0] + '-01-01')) / 86400000);
  return DARK_FEMININE_QUOTES[dayOfYear % DARK_FEMININE_QUOTES.length];
}

function getDailySutra(dateStr) {
  const dayOfYear = Math.floor((new Date(dateStr) - new Date(dateStr.split('-')[0] + '-01-01')) / 86400000);
  // Offset so quote and sutra don't cycle in lockstep
  return TANTRIC_SUTRAS[(dayOfYear + 7) % TANTRIC_SUTRAS.length];
}

export { getDailyQuote, getDailySutra, DARK_FEMININE_QUOTES, TANTRIC_SUTRAS };
