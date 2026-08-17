interface ConversationMessage {
  sender: 'user' | 'ai';
  text: string;
}

export const evaluateWhoAmI = (transcript: string) => {
  const words = transcript.trim().toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const wordCount = words.length;
  const uniqueWordCount = new Set(words).size;
  const score = wordCount >= 60 ? 3 : wordCount >= 30 ? 2 : 1;
  const evaluation = {
    score_clarity: score,
    score_completeness: score,
    score_courtesy: 3,
    score_correctness: score,
    score_conciseness: wordCount <= 140 ? 3 : 2,
    score_vocabulary: uniqueWordCount >= 45 ? 5 : uniqueWordCount >= 32 ? 4 : uniqueWordCount >= 20 ? 3 : uniqueWordCount >= 10 ? 2 : 1,
    score_grammar: wordCount >= 60 ? 5 : wordCount >= 45 ? 4 : wordCount >= 30 ? 3 : wordCount >= 15 ? 2 : 1,
    feedback_summary: 'Introduction submitted. Review clarity, completeness, courtesy, correctness, conciseness, and delivery.',
  };
  return {
    evaluation,
    localScore: evaluation.score_clarity + evaluation.score_completeness + evaluation.score_courtesy
      + evaluation.score_correctness + evaluation.score_conciseness,
  };
};

export const evaluateActiveListening = (messages: ConversationMessage[]) => {
  const userText = messages.filter(message => message.sender === 'user').map(message => message.text).join(' ');
  const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;
  const score = wordCount >= 80 ? 4 : wordCount >= 40 ? 3 : 2;
  const evaluation = {
    score_vocabulary: score,
    score_clarity: score,
    score_grammar: score,
    score_courtesy: 4,
    score_conciseness: score,
  };
  return {
    evaluation,
    localScore: evaluation.score_vocabulary + evaluation.score_clarity + evaluation.score_grammar
      + evaluation.score_courtesy + evaluation.score_conciseness,
  };
};

export const evaluatePostTest = (messages: ConversationMessage[]) => {
  const userTurns = messages.filter(message => message.sender === 'user' && message.text.trim()).length;
  const baseScore = userTurns >= 5 ? 4 : userTurns >= 3 ? 3 : 2;
  const evaluation = {
    score_vocabulary: baseScore,
    score_clarity: baseScore,
    score_grammar: baseScore,
    score_courtesy: 4,
    score_conciseness: baseScore,
    feedback_summary: 'Post-test interview completed. Review the transcript for detailed performance notes.',
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
  const criteria = {
    vocabulary: baseScore, clarity: baseScore, grammar: baseScore, conciseness: baseScore,
    task_completion: 3, courtesy: 4,
  };
  const rawScore = Object.values(criteria).reduce((total, value) => total + value, 0);
  const percentage = Math.round(((rawScore / 30) * 100) * 100) / 100;
  const feedbackSummary = rawScore >= 20
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
}

// Exact local port of backend/routers/drills.py negotiation_turn.
export const getOfflineNegotiationTurn = (message: string, turnNumber: number, currentOffer: number): NegotiationTurnResult => {
  const normalized = message.toLowerCase();
  if (turnNumber >= 5) return {
    response: 'This is our final offer. We cannot negotiate further and will have to rescind the offer. Have a good day.',
    agreementReached: false, newOffer: currentOffer, isGameOver: true,
  };
  if (['agree', 'accept', 'deal', 'sounds good'].some(term => normalized.includes(term))) return {
    response: 'Great, we have a deal! Welcome to the team.',
    agreementReached: true, newOffer: currentOffer, isGameOver: true,
  };
  if (['benefits', 'stock', 'equity', 'vacation', 'bonus'].some(term => normalized.includes(term))) return {
    response: 'We can offer 5 extra vacation days and some stock options, but the base salary remains strictly fixed. Does that work for you?',
    agreementReached: false, newOffer: currentOffer, isGameOver: false,
  };
  if (currentOffer < 40000) {
    const newOffer = currentOffer + 2000;
    return {
      response: `We can bump it up slightly to ₱${newOffer}, but that is absolutely our ceiling given our budget constraint. Take it or leave it.`,
      agreementReached: false, newOffer, isGameOver: false,
    };
  }
  return {
    response: "That's completely out of our budget given the current market conditions. What else can you offer to justify that rate?",
    agreementReached: false, newOffer: currentOffer, isGameOver: false,
  };
};
