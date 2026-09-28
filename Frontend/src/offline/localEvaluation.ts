interface ConversationMessage {
  sender: 'user' | 'ai';
  text: string;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
const repetitionDominated = (text: string): boolean => {
  const tokens = words(text);
  if (tokens.length < 12) return false;
  const trigrams = tokens.slice(0, -2).map((_, index) => tokens.slice(index, index + 3).join(' '));
  const counts = new Map<string, number>();
  trigrams.forEach(trigram => counts.set(trigram, (counts.get(trigram) || 0) + 1));
  return new Set(tokens).size / tokens.length < 0.28
    || new Set(trigrams).size / trigrams.length < 0.45
    || Math.max(...counts.values()) >= Math.max(4, Math.floor(trigrams.length / 4));
};

const listeningStopWords = new Set('a an and are as at be by for from had has have i in is it my of on or our that the their them there these they this to was were will with you your summarize please listen carefully'.split(' '));

export const evaluateWhoAmI = (transcript: string) => {
  const words = transcript.trim().toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const wordCount = words.length;
  const uniqueWordCount = new Set(words).size;
  const score = wordCount >= 60 ? 3 : wordCount >= 30 ? 2 : 1;
  const normalized = transcript.toLowerCase();
  const requestedDetails = [
    /\b(my name|i am|i'm|call me)\b/,
    /\b(course|department|major|studying|study|student|degree)\b/,
    /\b(interest|enjoy|passion|like|focus)\b/,
    /\b(strength|skill|good at|able to|experience)\b/,
    /\b(interview|career|job|goal|prepare|future)\b/,
  ].filter(pattern => pattern.test(normalized)).length;
  const cap = repetitionDominated(transcript) || wordCount < 12 || requestedDetails <= 1
    ? 1 : requestedDetails <= 3 || wordCount < 25 ? 2 : 3;
  const evaluation = {
    score_clarity: Math.min(score, cap),
    score_completeness: Math.min(score, cap),
    score_courtesy: Math.min(3, cap),
    score_correctness: Math.min(score, cap),
    score_conciseness: Math.min(wordCount <= 140 ? 3 : 2, cap),
    score_vocabulary: Math.min(uniqueWordCount >= 45 ? 5 : uniqueWordCount >= 32 ? 4 : uniqueWordCount >= 20 ? 3 : uniqueWordCount >= 10 ? 2 : 1, cap),
    score_grammar: Math.min(wordCount >= 60 ? 5 : wordCount >= 45 ? 4 : wordCount >= 30 ? 3 : wordCount >= 15 ? 2 : 1, cap),
    feedback_summary: cap < 3 ? 'Add the requested personal, academic, and career details without repeating fragments.' : 'Introduction submitted. Review clarity, completeness, courtesy, correctness, conciseness, and delivery.',
  };
  return {
    evaluation,
    localScore: evaluation.score_clarity + evaluation.score_completeness + evaluation.score_courtesy
      + evaluation.score_correctness + evaluation.score_conciseness,
  };
};

export const evaluateActiveListening = (messages: ConversationMessage[]) => {
  const userText = messages.filter(message => message.sender === 'user').map(message => message.text).join(' ');
  const story = messages.find(message => message.sender === 'ai')?.text || '';
  const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;
  const score = wordCount >= 80 ? 4 : wordCount >= 40 ? 3 : 2;
  const storyTerms = new Set(words(story).filter(word => word.length > 2 && !listeningStopWords.has(word)));
  const answerTerms = new Set(words(userText));
  const coverage = [...storyTerms].filter(word => answerTerms.has(word)).length / Math.max(1, storyTerms.size);
  const cap = repetitionDominated(userText) || wordCount < 10 || coverage < 0.12 ? 2 : coverage < 0.22 ? 3 : 5;
  const evaluation = {
    score_vocabulary: Math.min(score, cap),
    score_clarity: Math.min(score, cap),
    score_grammar: Math.min(score, cap),
    score_courtesy: Math.min(4, cap),
    score_conciseness: Math.min(score, cap),
    feedback_summary: cap < 4 ? 'The summary needs more concrete details from the listening story and less repetition.' : 'The summary covered the listening story.',
  };
  return {
    evaluation,
    localScore: evaluation.score_vocabulary + evaluation.score_clarity + evaluation.score_grammar
      + evaluation.score_courtesy + evaluation.score_conciseness,
  };
};

export const evaluatePostTest = (messages: ConversationMessage[]) => {
  const answers = messages.filter(message => message.sender === 'user' && message.text.trim()).map(message => message.text.trim());
  const userTurns = answers.length;
  const baseScore = userTurns >= 5 ? 4 : userTurns >= 3 ? 3 : 2;
  const cap = userTurns < 5 || repetitionDominated(answers.join(' ')) || new Set(answers.map(answer => answer.toLowerCase())).size <= 2
    ? 2 : answers.filter(answer => words(answer).length < 8).length >= 3 ? 3 : 5;
  const evaluation = {
    score_vocabulary: Math.min(baseScore, cap),
    score_clarity: Math.min(baseScore, cap),
    score_grammar: Math.min(baseScore, cap),
    score_courtesy: Math.min(4, cap),
    score_conciseness: Math.min(baseScore, cap),
    feedback_summary: cap < 4 ? 'Several interview answers need distinct, relevant detail.' : 'Post-test interview completed. Review the transcript for detailed performance notes.',
  };
  return {
    evaluation,
    localScore: evaluation.score_vocabulary + evaluation.score_clarity + evaluation.score_grammar
      + evaluation.score_courtesy + evaluation.score_conciseness,
  };
};

const DRILL_WORD_THRESHOLDS: Record<string, [number, number]> = {
  jam: [30, 60], fast_word: [4, 8], emotion: [2, 4], synonym: [2, 3],
  fake_profile: [15, 30], emoji_story: [15, 30], taboo: [15, 30],
  elevator_pitch: [20, 40], rephrase: [8, 15], positive_framing: [8, 15], crisis: [25, 50],
};

export interface DrillEvaluationInput {
  spokenResponse: string;
  negotiationMessages: Array<{ sender: 'user' | 'bot'; text: string }>;
}

export const evaluateDrill = (drillType: string, input: DrillEvaluationInput) => {
  const userMessages = input.negotiationMessages
    .filter(message => message.sender === 'user' && message.text.trim())
    .map(message => message.text.trim());
  const response = drillType === 'negotiation' ? userMessages.join(' ') : input.spokenResponse.trim();
  if (!response) throw new Error('A spoken response is required before this Drill can be scored.');

  const measuredValue = drillType === 'negotiation'
    ? userMessages.length
    : (response.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)?/g) || []).length;
  const measurement = drillType === 'negotiation' ? 'user_turns' : 'spoken_words';
  const [developingThreshold, proficientThreshold] = drillType === 'negotiation'
    ? [3, 5]
    : (DRILL_WORD_THRESHOLDS[drillType] || [15, 30]);
  const baseScore = measuredValue >= proficientThreshold ? 4 : measuredValue >= developingThreshold ? 3 : 2;
  const qualityIssue = repetitionDominated(response);
  const adjustedBaseScore = qualityIssue ? Math.min(baseScore, 2) : baseScore;
  const criteria = {
    vocabulary: adjustedBaseScore, clarity: adjustedBaseScore, grammar: adjustedBaseScore, conciseness: adjustedBaseScore,
    task_completion: qualityIssue ? 1 : 3, courtesy: 4,
  };
  const rawScore = Object.values(criteria).reduce((total, value) => total + value, 0);
  const percentage = Math.round(((rawScore / 30) * 100) * 100) / 100;
  const feedbackSummary = qualityIssue
    ? 'The response repeated the same fragments instead of developing the task.'
    : rawScore >= 20
    ? `Drill completed successfully with ${measuredValue} ${measurement.replace('_', ' ')}. The response met the expected participation threshold.`
    : `Drill completed with ${measuredValue} ${measurement.replace('_', ' ')}. Aim for at least ${proficientThreshold} ${measurement.replace('_', ' ')} to meet the proficiency threshold.`;
  return {
    evaluation: {
      score: percentage,
      passed: rawScore >= 20,
      feedback_summary: feedbackSummary,
      scoring: {
        rubric_version: 'drill-communication-v1', measurement, measured_value: measuredValue,
        developing_threshold: developingThreshold, proficient_threshold: proficientThreshold,
        criteria, raw_score: rawScore, max_score: 30, passing_score: 20, percentage,
      },
    },
    localScore: percentage,
  };
};

export interface NegotiationTurnResult {
  response: string;
  agreementReached: boolean;
  newOffer: number;
  isGameOver: boolean;
  status: 'negotiating' | 'agreed' | 'closed';
  acceptedSalary: number | null;
}

export const isClearNegotiationAcceptance = (message: string, currentOffer: number): boolean => {
  const text = message.toLowerCase().replace(/’/g, "'").trim();
  if (!text || text.includes('?')) return false;
  if (/\b(?:don't|do not|not|can't|cannot|won't)\s+(?:want to\s+)?(?:accept|agree|take)\b/.test(text)) return false;
  if (/\b(?:too low|still low|think about it|more|higher|increase|raise|counter|negotiate|instead)\b/.test(text)) return false;
  if (/\b(?:can|could|would)\s+you\b|\bwhat about\b|\bbetter benefits\b/.test(text)) return false;
  const salaryMentions = [...text.matchAll(/(?:^|[^\w])(?:₱\s*)?(\d{2,3})(?:\s*k|,?000)\b/g)]
    .map(match => Number(match[1]) * 1000);
  if (salaryMentions.some(amount => amount !== currentOffer)) return false;
  return /\b(?:i|we)\s+(?:will\s+|would\s+|can\s+)?accept\b/.test(text)
    || /\baccept\s+(?:the\s+|your\s+|this\s+)?(?:offer|salary)\b/.test(text)
    || /\b(?:i'll|i will|we'll|we will)\s+take\s+(?:it|the offer)\b/.test(text)
    || /\b(?:i|we)\s+agree\b/.test(text)
    || /\b(?:that|this|the offer|\d{2,3}\s*k|\d{2,3},?000)\s+works\s+for\s+me\b/.test(text)
    || /^(?:okay[,! ]*)?(?:deal|it's a deal|we have a deal)[.!]*$/.test(text)
    || /^(?:okay[,! ]*)?sounds good[.!]*$/.test(text);
};

// Mirror of the deterministic backend negotiation decisions for offline turns.
export const getOfflineNegotiationTurn = (
  message: string, turnNumber: number, currentOffer: number,
  status: NegotiationTurnResult['status'] = 'negotiating', acceptedSalary: number | null = null,
): NegotiationTurnResult => {
  if (status === 'closed') return {
    response: acceptedSalary === null ? 'Thank you for your time. Have a good day.' : "You're welcome. We look forward to working with you.",
    agreementReached: acceptedSalary !== null, newOffer: currentOffer, isGameOver: true,
    status: 'closed', acceptedSalary,
  };
  if (status === 'agreed') return {
    response: "You're welcome. We look forward to working with you.",
    agreementReached: true, newOffer: currentOffer, isGameOver: true,
    status: 'closed', acceptedSalary: acceptedSalary ?? currentOffer,
  };
  if (isClearNegotiationAcceptance(message, currentOffer)) return {
    response: `Great, we have a deal at ₱${currentOffer.toLocaleString('en-US')}. Welcome to the team.`,
    agreementReached: true, newOffer: currentOffer, isGameOver: true,
    status: 'agreed', acceptedSalary: currentOffer,
  };
  if (turnNumber >= 5) return {
    response: 'This is our final offer. We cannot negotiate further and will have to rescind the offer. Have a good day.',
    agreementReached: false, newOffer: currentOffer, isGameOver: true,
    status: 'closed', acceptedSalary: null,
  };
  if (/\b(?:goodbye|bye)\b/i.test(message)) return {
    response: 'Thank you for your time. Have a good day.',
    agreementReached: false, newOffer: currentOffer, isGameOver: true,
    status: 'closed', acceptedSalary: null,
  };
  if (/\b(?:thank you|thanks)\b/i.test(message)) return {
    response: "You're welcome. Let me know if you would like to discuss the current offer further.",
    agreementReached: false, newOffer: currentOffer, isGameOver: false,
    status: 'negotiating', acceptedSalary: null,
  };
  if (/\b(?:benefits|stock|equity|vacation|bonus)\b/i.test(message)) return {
    response: 'We can offer 5 extra vacation days and some stock options, but the base salary remains strictly fixed. Does that work for you?',
    agreementReached: false, newOffer: currentOffer, isGameOver: false,
    status: 'negotiating', acceptedSalary: null,
  };
  if (currentOffer < 40000) {
    const newOffer = currentOffer + 2000;
    return {
      response: `We can bump it up slightly to ₱${newOffer}, but that is absolutely our ceiling given our budget constraint. Take it or leave it.`,
      agreementReached: false, newOffer, isGameOver: false,
      status: 'negotiating', acceptedSalary: null,
    };
  }
  return {
    response: "That's completely out of our budget given the current market conditions. What else can you offer to justify that rate?",
    agreementReached: false, newOffer: currentOffer, isGameOver: false,
    status: 'negotiating', acceptedSalary: null,
  };
};
