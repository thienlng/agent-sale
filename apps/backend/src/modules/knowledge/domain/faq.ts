import { foldVietnamese, newId, type WorkspaceId } from '@agent-sales/shared';

import { InvalidFaqError } from './knowledge.errors.js';

export type FaqSource = 'seed' | 'manual' | 'import';

export interface FaqProps {
  id: string;
  workspaceId: WorkspaceId;
  botId: string;
  question: string;
  answer: string;
  source: FaqSource;
  createdAt: Date;
  updatedAt: Date;
}

/** A question/answer pair the bot may use verbatim. Always valid. */
export class Faq {
  private constructor(private props: FaqProps) {}

  static create(input: {
    workspaceId: WorkspaceId;
    botId: string;
    question: string;
    answer: string;
    source: FaqSource;
  }): Faq {
    const now = new Date();
    const faq = new Faq({
      ...input,
      id: newId(),
      question: '',
      answer: '',
      createdAt: now,
      updatedAt: now,
    });
    faq.edit({ question: input.question, answer: input.answer });
    faq.props.updatedAt = now;
    return faq;
  }

  static rehydrate(props: FaqProps): Faq {
    return new Faq(props);
  }

  edit(change: { question?: string | undefined; answer?: string | undefined }): void {
    const question = (change.question ?? this.props.question).trim();
    const answer = (change.answer ?? this.props.answer).trim();
    if (question.length < 3 || question.length > 500)
      throw new InvalidFaqError('question must be 3–500 characters');
    if (answer.length < 1 || answer.length > 4000)
      throw new InvalidFaqError('answer must be 1–4000 characters');
    this.props = { ...this.props, question, answer, updatedAt: new Date() };
  }

  /** Folded text indexed for trigram search (lowercase, no diacritics). */
  searchText(): string {
    return foldVietnamese(`${this.props.question} ${this.props.answer}`);
  }

  get id(): string {
    return this.props.id;
  }

  snapshot(): Readonly<FaqProps> {
    return { ...this.props };
  }
}
