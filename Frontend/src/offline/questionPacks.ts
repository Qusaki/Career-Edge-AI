import type { OfflineActivityType } from '../db';

// These copies mirror the canonical backend question/prompt constants. Any
// backend wording or ordering change must increment the matching version here.
export const PRETEST_WHO_AM_I_VERSION = 'pretest-who-am-i-v1';
export const PRETEST_ACTIVE_LISTENING_VERSION = 'pretest-active-listening-v1';
export const POST_TEST_VERSION = 'posttest-v1';
export const DRILLS_VERSION = 'drills-v1';
export const ENROLLMENT_INTERVIEW_VERSION = 'enrollment-interview-v1';
export const THESIS_INTERVIEW_VERSION = 'thesis-interview-v1';
export const NEGOTIATION_OPENING_PROMPT =
  'We can offer ₱35,000 for this role. Given our budget constraint, that is already a competitive starting offer. What do you think?';

// Canonical source: the existing Who Am I prompt rendered by PreTestPage and
// accepted as a single transcript by backend/routers/pre_test_intro.py.
export const PRETEST_WHO_AM_I_PROMPT =
  'Please introduce yourself. Include your name, course or department, interests, strengths, and why you are preparing for interviews.';

// Canonical source: backend/routers/pre_test_active_listening.py.
export const ACTIVE_LISTENING_PROMPTS = [
  "Listen carefully to this workplace update. On Monday morning, the admissions team received a request to prepare orientation kits for one hundred twenty incoming students. The printed schedules were ready, but the campus maps still had the old library entrance marked, so Mara asked Luis to update the maps before lunch. At two o'clock, the team discovered that thirty scholarship forms were missing signatures from the finance office. Instead of delaying all the kits, they placed a yellow note on those thirty folders and packed the remaining ninety. By four thirty, the updated maps arrived, but only eighty reusable water bottles had been delivered. Mara decided that students from the first two orientation groups would receive bottles immediately, while the rest would pick theirs up the next day at the guidance desk. Now summarize the key details, especially the numbers, times, people, and decisions.",
  'Please listen to these event instructions. A student leadership workshop will begin at eight thirty in the multimedia hall, but participants must arrive by eight fifteen for attendance and seat assignments. Each group should bring one laptop, two printed copies of their action plan, and a backup copy saved on a flash drive. The morning session focuses on problem identification, the lunch break is from twelve to one, and the afternoon session is for presentation practice. If the projector in the multimedia hall is still unavailable, the workshop will move to Room 204, but registration will remain near the main lobby. After the final presentation, group leaders must submit the attendance sheet and revised action plan to Ms. Reyes before leaving. Summarize the schedule, materials, backup location, and final requirements.',
  'Here is a short story to summarize. During the community reading program, Jonah volunteered to manage book donations while Aira handled student registration. They expected fifty pupils, but seventy-two arrived because a nearby school joined at the last minute. The team had enough storybooks, but only forty-eight activity sheets, so Jonah photocopied twenty-five more while Aira divided the pupils into six smaller groups. The guest reader was delayed by heavy rain, so the volunteers started with a vocabulary game and moved the storytelling activity after the snack break. By the end of the program, every pupil received a book, but only the first sixty received certificates because the printer ran out of ink. Please summarize the important events, problems, numbers, and solutions.',
] as const;

// Canonical source: backend/routers/post_test_interview.py.
export const getPostTestQuestions = (department: string): readonly string[] => {
  const normalized = department.trim().toUpperCase();
  const contextQuestion = normalized === 'CTE'
    ? 'Tell me about a time you explained a difficult lesson or idea to someone. How did you make sure they understood you?'
    : normalized === 'CBAPA'
      ? 'Tell me about a time you explained difficult business, financial, or policy information. How did you make it clear to your listener?'
      : 'Tell me about a time you explained a difficult technical idea to someone. How did you make sure they understood you?';

  return [
    'Please introduce yourself briefly and describe one communication skill you have improved during your training.',
    contextQuestion,
    'Can you describe a challenging situation where you had to solve a problem, explain the steps you took, and share what you learned from the experience?',
    'Imagine that you disagree with a teammate during an important task. How would you communicate your concern respectfully and help the group reach a decision?',
    'What communication skill do you still want to improve, and what specific actions will you take to improve it?',
  ];
};

export interface OfflineInterviewQuestion {
  id: string;
  text: string;
}

const ENROLLMENT_QUESTION_PACKS: Record<string, readonly OfflineInterviewQuestion[]> = {
  CTE: [
    { id: 'cte-major', text: 'Welcome to your enrollment interview. Which specific Teacher Education major are you choosing, and why does it fit your goals?' },
    { id: 'cte-subject-teaching', text: 'Which subject area interests you most, and how would you help a learner understand a difficult idea in that subject?' },
    { id: 'cte-motivation-values', text: 'What motivates you to become an educator, and which personal value would guide how you treat your future students?' },
    { id: 'cte-problem-solving', text: 'Imagine a student continues to struggle after your first explanation. How would you identify the problem and adjust your approach?' },
    { id: 'cte-leadership-preparation', text: 'Describe an experience where you helped lead or support a group, and explain how it prepared you for Teacher Education.' },
  ],
  CBAPA: [
    { id: 'cbapa-major', text: 'Welcome to your enrollment interview. Which specific CBAPA major are you choosing, and why does it fit your goals?' },
    { id: 'cbapa-business-fundamentals', text: 'What business, accounting, or public-service issue interests you most, and what do you already understand about it?' },
    { id: 'cbapa-analysis', text: 'Describe a problem where you had to compare information before deciding what to do. How did you reach your decision?' },
    { id: 'cbapa-entrepreneurship-leadership', text: 'If you could improve one service or create one practical venture for your community, what would it be and how would you organize a team around it?' },
    { id: 'cbapa-ethics-preparation', text: 'How would you respond if a teammate suggested an easier but unethical way to complete an important task, and how are you preparing for your chosen major?' },
  ],
  CCIT: [
    { id: 'ccit-track', text: 'Welcome to your enrollment interview. Which Computer Science track or technical area are you pursuing, and why does it interest you?' },
    { id: 'ccit-technical-fundamentals', text: 'Explain one computing concept or technology you have explored and what you learned from it.' },
    { id: 'ccit-problem-solving', text: 'Describe a difficult problem you faced. How did you break it into smaller steps and decide whether your solution worked?' },
    { id: 'ccit-coding-basics', text: 'If you were asked to build a small program for students, what would it do and how would you organize its basic logic?' },
    { id: 'ccit-communication-soft-skills', text: 'Tell me about a time you worked with others or explained an idea clearly. What will that experience contribute to your Computer Science studies?' },
  ],
};

const THESIS_QUESTION_PACKS: Record<string, readonly OfflineInterviewQuestion[]> = {
  CTE: [
    { id: 'cte-pedagogical-innovation', text: 'Based on your abstract, concisely present your pedagogical innovation or action research and the classroom problem it addresses.' },
    { id: 'cte-action-research', text: 'Defend your action-research methodology. Why are its participants, instruments, and procedure appropriate for the problem in your abstract?' },
    { id: 'cte-learning-outcomes', text: 'Which learning outcomes will show that your intervention works, and how will you assess those outcomes reliably?' },
    { id: 'cte-literature-deped', text: 'How does your study align with the literature and relevant DepEd priorities, and what gap does it address?' },
    { id: 'cte-demo-scalability', text: 'Explain how you would demonstrate the intervention in practice and how it could be scaled or translated into a policy recommendation.' },
  ],
  CBAPA: [
    { id: 'cbapa-research-problem', text: 'Based on your abstract, state your core research problem and defend its relevance to business, accountancy, or public administration.' },
    { id: 'cbapa-methodology', text: 'Defend your methodology and data-analysis plan. Why are they appropriate for answering the research problem?' },
    { id: 'cbapa-practical-roi', text: 'What practical recommendation should decision-makers take from this study, and how would you assess its cost, benefit, or return on investment?' },
    { id: 'cbapa-literature-framework', text: 'Which theoretical framework and related literature support your study, and where does your work add something new?' },
    { id: 'cbapa-delivery-limitations', text: 'Present your strongest expected contribution, then acknowledge the most important limitation you would defend before a professional panel.' },
  ],
  CCIT: [
    { id: 'ccit-technical-innovation', text: 'Based on your abstract, describe your technical innovation or system architecture and the problem it is designed to solve.' },
    { id: 'ccit-implementation-performance', text: 'Defend your implementation choices and identify the performance metrics you will use to show the system works effectively.' },
    { id: 'ccit-experimental-validation', text: 'Explain your experimental methodology or validation plan. How will you know that the results are reliable?' },
    { id: 'ccit-related-work', text: 'How does your proposed work differ from the most relevant systems or studies in your literature review?' },
    { id: 'ccit-demo-limitations', text: 'Describe the evidence you would present in a live demonstration, and identify one important limitation or failure case the panel should understand.' },
  ],
};

const normalizeInterviewDepartment = (department: string): 'CCIT' | 'CTE' | 'CBAPA' => {
  const normalized = department.trim().toUpperCase();
  return normalized === 'CTE' || normalized === 'CBAPA' ? normalized : 'CCIT';
};

export const getEnrollmentInterviewQuestions = (department: string): readonly OfflineInterviewQuestion[] =>
  ENROLLMENT_QUESTION_PACKS[normalizeInterviewDepartment(department)];

export const getThesisInterviewQuestions = (department: string): readonly OfflineInterviewQuestion[] =>
  THESIS_QUESTION_PACKS[normalizeInterviewDepartment(department)];

// Canonical source: generator constants in backend/routers/drills.py.
const DRILL_POOLS = {
  jam: ['Coffee', 'Smartphones', 'The Future of AI', 'My Favorite Book', 'Why Sleep is Important', 'Traveling', 'The Ocean', 'Social Media'],
  fast_word: ['Database', 'Cloud', 'Network', 'Algorithm', 'Security', 'Frontend', 'Backend', 'Python', 'Server'],
  emotionSentences: ["The food is here.", "I can't believe this is happening.", "Look at what you've done.", "It's time to go home.", 'Are you sure about that?'],
  emotions: ['Angry', 'Excited', 'Sad', 'Confused', 'Nervous', 'Joyful'],
  synonym: ['Good', 'Fast', 'Big', 'Small', 'Happy', 'Sad', 'Hard', 'Easy'],
  names: ['Alex', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley'],
  ages: [22, 28, 35, 41, 19, 50],
  jobs: ['Astronaut', 'Chef', 'Software Engineer', 'Teacher', 'Pilot', 'Artist'],
  hobbies: ['Cooking', 'Skydiving', 'Reading', 'Gaming', 'Gardening', 'Photography'],
  emojis: ['🚀', '🍕', '🐱', '🎸', '⛰️', '📱', '🎈', '👻', '🌮', '🐉'],
  taboo: [
    { topic: 'How to cook rice', banned_words: ['Rice', 'Water', 'Cooker', 'Eat'] },
    { topic: 'How to ride a bike', banned_words: ['Pedal', 'Wheels', 'Balance', 'Ride'] },
    { topic: 'Explain what a database is', banned_words: ['Data', 'Store', 'SQL', 'Table'] },
    { topic: 'How to make a sandwich', banned_words: ['Bread', 'Meat', 'Eat', 'Cheese'] },
  ],
  elevator_pitch: [
    'Pitch your app idea to a billionaire in an elevator.',
    'Pitch yourself for your dream job to the CEO in 30 seconds.',
    'Convince a busy investor why your startup will change the world.',
    'Pitch your thesis topic to a skeptical professor.',
  ],
  rephrase: [
    'In the event of an unforeseen exigency, it is imperative that personnel evacuate the premises expeditiously using the designated egress routes to ensure maximal survivability.',
    'The utilization of heterogeneous data structures facilitates the optimization of algorithmic complexity, thereby ameliorating the latency inherent in synchronous processing paradigms.',
    'Notwithstanding the aforementioned stipulations, the contractual obligations remain binding in perpetuity unless mutually abrogated by all signatory parties involved in the agreement.',
  ],
  positive_framing: [
    'Your app is slow, full of bugs, and completely ruined my project!',
    'I have been waiting on hold for an hour, your customer service is terrible and incompetent.',
    "The product arrived broken and it's cheaply made. I demand a refund right now.",
    'You completely ignored my email and missed the deadline, you are highly unprofessional.',
  ],
  crisisScenarios: [
    'Your system got hacked and user data leaked!',
    "A critical bug caused your company's main app to crash globally for 24 hours.",
    'Your new product launch caught on fire during a live demonstration.',
    'A top executive was caught embezzling funds from the charity division.',
  ],
  crisisQuestions: [
    'Why did you hide this from the public?!',
    'Who is taking responsibility for this disaster?',
    'What are you doing to fix this right now?',
    'Are you going to resign over this?',
    'How can users ever trust you again?',
    'Is it true you knew about this for weeks?',
  ],
} as const;

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const choose = <T>(items: readonly T[], seed: string): T => items[stableHash(seed) % items.length];
const chooseMany = <T>(items: readonly T[], count: number, seed: string): T[] => {
  const copy = [...items];
  const selected: T[] = [];
  let cursor = stableHash(seed);
  while (copy.length && selected.length < count) {
    const index = cursor % copy.length;
    selected.push(copy.splice(index, 1)[0]);
    cursor = stableHash(`${seed}:${cursor}:${selected.length}`);
  }
  return selected;
};

export const getOfflineActiveListeningPrompt = (clientSessionId: string): string =>
  choose(ACTIVE_LISTENING_PROMPTS, clientSessionId);

export const getActiveListeningPromptForServerSession = (serverSessionId: number): string =>
  ACTIVE_LISTENING_PROMPTS[serverSessionId % ACTIVE_LISTENING_PROMPTS.length];

export const getOfflineDrillPrompt = (drillType: string, clientSessionId: string): Record<string, unknown> => {
  const seed = `${clientSessionId}:${drillType}`;
  switch (drillType) {
    case 'jam': return { topic: choose(DRILL_POOLS.jam, seed) };
    case 'fast_word': return { word: choose(DRILL_POOLS.fast_word, seed) };
    case 'emotion': return {
      sentence: choose(DRILL_POOLS.emotionSentences, `${seed}:sentence`),
      emotion: choose(DRILL_POOLS.emotions, `${seed}:emotion`),
    };
    case 'synonym': return { word: choose(DRILL_POOLS.synonym, seed) };
    case 'fake_profile': return {
      name: choose(DRILL_POOLS.names, `${seed}:name`),
      age: choose(DRILL_POOLS.ages, `${seed}:age`),
      job: choose(DRILL_POOLS.jobs, `${seed}:job`),
      hobby: choose(DRILL_POOLS.hobbies, `${seed}:hobby`),
    };
    case 'emoji_story': return { emojis: chooseMany(DRILL_POOLS.emojis, 3, seed) };
    case 'taboo': return choose(DRILL_POOLS.taboo, seed);
    case 'elevator_pitch': return { scenario: choose(DRILL_POOLS.elevator_pitch, seed) };
    case 'rephrase': return { text: choose(DRILL_POOLS.rephrase, seed) };
    case 'positive_framing': return { complaint: choose(DRILL_POOLS.positive_framing, seed) };
    case 'crisis': return {
      scenario: choose(DRILL_POOLS.crisisScenarios, `${seed}:scenario`),
      questions: chooseMany(DRILL_POOLS.crisisQuestions, 4, `${seed}:questions`),
    };
    case 'negotiation': return {
      scenario: 'You are negotiating a starting salary. The employer opens with ₱35,000 and is strict about the budget.',
      instruction: 'Reply professionally. You can accept, negotiate salary, or ask about benefits.',
    };
    default: throw new Error(`Unsupported offline drill type: ${drillType}`);
  }
};

export const getQuestionPackVersion = (type: OfflineActivityType): string | null => {
  if (type === 'pre_test_intro') return PRETEST_WHO_AM_I_VERSION;
  if (type === 'pre_test_active_listening') return PRETEST_ACTIVE_LISTENING_VERSION;
  if (type === 'post_test') return POST_TEST_VERSION;
  if (type === 'drill') return DRILLS_VERSION;
  if (type === 'upcoming') return ENROLLMENT_INTERVIEW_VERSION;
  if (type === 'thesis') return THESIS_INTERVIEW_VERSION;
  return null;
};

export const hasCurrentQuestionPack = (type: OfflineActivityType, version: string | null): boolean =>
  getQuestionPackVersion(type) === version;
