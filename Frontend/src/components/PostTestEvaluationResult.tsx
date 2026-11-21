export type PostTestQuestionEvaluation = {
  question_index: number;
  criteria: Record<'vocabulary' | 'clarity' | 'grammar' | 'courtesy' | 'conciseness', number>;
  answer_relevance: number;
  learning_evidence: number;
  feedback: string | null;
  scoring_authority: 'semantic_ai_with_objective_caps' | 'deterministic_fallback';
};

export type PostTestEvaluationData = {
  schema_version: 'post-test-evaluation-v2';
  question_pack_version: string;
  scoring_authority: 'semantic_ai_with_objective_caps' | 'deterministic_fallback';
  question_evaluations: PostTestQuestionEvaluation[];
  aggregate_criteria: PostTestQuestionEvaluation['criteria'];
  total_score: number;
  passed: boolean;
  overall_feedback: string;
  recommendations: string[];
};

export type PostTestCompletionResult = {
  total_score: number;
  passed: boolean;
  feedback_summary: string;
  evaluation_data: PostTestEvaluationData | null;
};

const criterionLabels = [
  ['vocabulary', 'Vocabulary'], ['clarity', 'Clarity'], ['grammar', 'Grammar'],
  ['courtesy', 'Courtesy'], ['conciseness', 'Conciseness'],
] as const;

export function PostTestEvaluationResult({
  result, questions, onClose,
}: {
  result: PostTestCompletionResult;
  questions: readonly string[];
  onClose: () => void;
}) {
  const detail = result.evaluation_data;
  const evaluations = [...(detail?.question_evaluations || [])].sort((a, b) => a.question_index - b.question_index);
  return (
    <section className="mx-auto w-full max-w-5xl space-y-5 text-ink" aria-labelledby="post-test-result-heading">
      <div className="rounded-xl border border-line bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-program-accent mb-1 text-xs font-bold uppercase tracking-[0.2em]">Post-Test Result</p>
            <h1 id="post-test-result-heading" className="text-2xl font-bold sm:text-3xl">Your evaluation</h1>
          </div>
          <button type="button" onClick={onClose} className="program-accent-focus-ring rounded-lg border border-line px-4 py-2 font-semibold hover:bg-active">
            Back to Post-Test
          </button>
        </div>
        <p className="mt-4 text-lg font-semibold">{result.total_score}/25 · {result.passed ? 'Passed' : 'Needs more practice'}</p>
        {detail?.scoring_authority === 'deterministic_fallback' && (
          <p role="status" className="mt-3 rounded-lg border border-line bg-background p-3 text-sm text-muted">
            Detailed AI feedback was unavailable. These are limited objective scores, not a semantic evaluation of your answers.
          </p>
        )}
        <h2 className="mt-5 font-semibold">Overall feedback</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{result.feedback_summary}</p>
        {detail && detail.recommendations.length > 0 && (
          <div className="mt-5">
            <h2 className="font-semibold">Recommendations</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {detail.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}
            </ul>
          </div>
        )}
      </div>
      {evaluations.map(evaluation => (
        <article key={evaluation.question_index} className="min-w-0 rounded-xl border border-line bg-card p-5 sm:p-6">
          <h2 className="text-lg font-bold">Question {evaluation.question_index}</h2>
          {questions[evaluation.question_index - 1] && (
            <p className="mt-1 text-sm leading-relaxed text-muted">{questions[evaluation.question_index - 1]}</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {criterionLabels.map(([key, label]) => (
              <p key={key} className="rounded-lg border border-line p-2"><span className="text-muted">{label}</span> <strong>{evaluation.criteria[key]}/5</strong></p>
            ))}
            <p className="rounded-lg border border-line p-2"><span className="text-muted">Answer Relevance</span> <strong>{evaluation.answer_relevance}/5</strong></p>
            <p className="rounded-lg border border-line p-2" title="How well the response demonstrates understanding through examples, reasoning, or specific actions.">
              <span className="text-muted">Learning Evidence</span> <strong>{evaluation.learning_evidence}/5</strong>
            </p>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">{evaluation.feedback || 'Detailed AI feedback is unavailable for this response.'}</p>
        </article>
      ))}
    </section>
  );
}
