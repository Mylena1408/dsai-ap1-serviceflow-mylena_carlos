import type { RequestFieldAnswer } from "@/modules/requests";
import { formatFieldAnswer } from "@/modules/service-fields";

type RequestFieldAnswersProps = {
  answers: RequestFieldAnswer[];
};

// Answers given on opening, with the labels of that moment (SPEC
// 2026-11-01-campos-personalizados, 5.4.3). Nothing is shown when there are none.
export function RequestFieldAnswers({ answers }: RequestFieldAnswersProps) {
  if (answers.length === 0) {
    return null;
  }

  return (
    <section className="surface-card content-section" aria-labelledby="field-answers-heading">
      <p className="eyebrow">Formulário</p>
      <h2 id="field-answers-heading">Informações do serviço</h2>
      <dl className="field-answers">
        {answers.map((answer) => (
          <div key={answer.id}>
            <dt>{answer.label}</dt>
            <dd className={answer.type === "LONG_TEXT" ? "request-description" : undefined}>
              {formatFieldAnswer(answer.type, answer.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
