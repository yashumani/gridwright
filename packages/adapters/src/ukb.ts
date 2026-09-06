import { describeFinding, scanText, type Finding } from "@gridwright/contracts";
import { AdapterError, classify, type Transport } from "./transport.js";

/**
 * A scoped client for the Unified Knowledge Base's context packs (task T11).
 *
 * The shapes below are taken from that project's own contract — its
 * `ContextPack` service and `docs/CONTEXT_PACK.md` — rather than invented here.
 * That is the whole point of an adapter: UKB owns approved knowledge and its
 * review lifecycle, and this code's job is to carry its answers across a
 * boundary without changing what they mean.
 *
 * Four rules do the work, and each of them exists because the obvious
 * implementation gets it wrong.
 *
 * **Denied is not missing.** R06 says so in one line, and it is the single
 * easiest thing to lose: a client that returns an empty pack for a 403 turns
 * "you are not allowed to see this" into "there is nothing to see", and the
 * answer built on top of it is confidently wrong. `access_decision: "denied"`
 * and a pack with no objects are different values here and stay different all
 * the way out.
 *
 * **Only published knowledge is context.** UKB distinguishes draft from
 * published, and a draft that reaches an answer is an unreviewed claim wearing
 * approved clothes. Anything not `published` is dropped, and the drop is
 * reported rather than silent.
 *
 * **Evidence keeps its own identifiers.** Source, version, chunk and locator
 * travel exactly as UKB issued them. R19 forbids minting claims of
 * certification, and a citation whose version was helpfully normalised on the
 * way through is no longer a citation of anything.
 *
 * **A pack is untrusted text.** Every quote in it came from a document
 * somebody uploaded. It is scanned (R24) before a caller does anything with
 * it, and the findings ride along so a caller putting this in front of a model
 * knows what it is putting there.
 */

export type AccessDecision = "allowed" | "denied";

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

/** A published knowledge object, as UKB models one. */
export interface KnowledgeObject {
  id: string;
  type: string;
  title: string;
  summary?: string;
  /** UKB's review status. Only `published` is usable as approved context. */
  status: string;
  domain?: string;
  source_ids?: string[];
}

/** A citation, with every identifier UKB issued kept intact. */
export interface Citation {
  object_id: string;
  source_id: string;
  source_version_id?: string;
  chunk_id?: string;
  title?: string;
  quote?: string;
  locator?: string;
}

export interface SourceEvidence {
  source_id: string;
  title?: string;
  content_excerpt?: string;
  current_version_id?: string;
  sensitivity?: string;
}

export interface Freshness {
  status: FreshnessStatus;
  oldest_source_age_days?: number;
}

/** The pack as UKB returns it, before this adapter looks at it. */
export interface RawContextPack {
  context_pack_id: string;
  question: string;
  user_id?: string;
  mode?: string;
  access_decision: AccessDecision;
  confidence?: number;
  answer_guidance?: string;
  knowledge_objects?: KnowledgeObject[];
  evidence?: SourceEvidence[];
  citations?: Citation[];
  caveats?: string[];
  conflicts?: unknown[];
  related_objects?: unknown[];
  recommended_followups?: string[];
  missing_context?: string[];
  freshness?: Freshness;
  generated_at?: string;
}

/**
 * What a caller gets: the pack, plus what this adapter had to say about it.
 *
 * `usable` is the question a caller actually has, answered once rather than
 * re-derived from three fields at every call site.
 */
export interface ContextPackResult {
  /** True only when access was allowed and at least one published object survived. */
  usable: boolean;
  decision: AccessDecision;
  packId: string;
  question: string;
  /** Published objects only. */
  objects: KnowledgeObject[];
  citations: Citation[];
  evidence: SourceEvidence[];
  caveats: string[];
  /** UKB's own account of what it could not find. Distinct from a denial. */
  missingContext: string[];
  confidence: number | undefined;
  freshness: Freshness;
  /** Objects dropped for not being published, by id. Reported, never silent. */
  droppedUnpublished: string[];
  /** R24 findings over every quote and summary in the pack. */
  untrusted: Finding[];
  /** One line per finding, safe to log. Never carries the matched text. */
  diagnostics: string[];
}

export interface ContextPackRequest {
  question: string;
  /** Domains the caller is scoped to. Passed through; UKB rechecks. */
  domains?: readonly string[];
  mode?: string;
  limit?: number;
}

export interface UkbOptions {
  /** Path the pack is served from. Default `/api/v1/context-pack`. */
  path?: string;
  /** Longest quote or summary scanned per value. Default 2000. */
  maxTextLength?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads approved context from UKB.
 *
 * Holds no credentials and chooses no host: the transport it is given already
 * carries whatever identity the deployment established, which is R05 expressed
 * as a constructor signature rather than a convention.
 */
export class UkbClient {
  private readonly transport: Transport;
  private readonly path: string;
  private readonly maxTextLength: number;

  constructor(transport: Transport, options: UkbOptions = {}) {
    this.transport = transport;
    this.path = options.path ?? "/api/v1/context-pack";
    this.maxTextLength = options.maxTextLength ?? 2000;
  }

  async contextPack(request: ContextPackRequest): Promise<ContextPackResult> {
    const response = await this.transport({
      method: "POST",
      path: this.path,
      body: {
        question: request.question,
        ...(request.domains ? { domains: [...request.domains] } : {}),
        ...(request.mode ? { mode: request.mode } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      },
    });

    // A 403 is an answer, not an absence. It becomes a denied pack rather than
    // an exception, because a denial is a state the caller must be able to
    // render — "you do not have access to this" is information.
    const failure = classify(response.status, "unified-knowledge-base");
    if (failure && failure.kind === "forbidden") {
      return this.denied(request.question, "access denied by the knowledge base");
    }
    if (failure) throw failure;

    if (!isObject(response.body)) {
      throw new AdapterError(
        "malformed",
        "the knowledge base answered with something that is not a context pack",
        "unified-knowledge-base",
      );
    }

    return this.read(response.body as unknown as RawContextPack, request.question);
  }

  private denied(question: string, reason: string): ContextPackResult {
    return {
      usable: false,
      decision: "denied",
      packId: "",
      question,
      objects: [],
      citations: [],
      evidence: [],
      caveats: [reason],
      missingContext: [],
      confidence: undefined,
      freshness: { status: "unknown" },
      droppedUnpublished: [],
      untrusted: [],
      diagnostics: [],
    };
  }

  private read(pack: RawContextPack, question: string): ContextPackResult {
    const decision: AccessDecision = pack.access_decision === "denied" ? "denied" : "allowed";

    const all = pack.knowledge_objects ?? [];
    const objects = all.filter((o) => o.status === "published");
    const droppedUnpublished = all.filter((o) => o.status !== "published").map((o) => o.id);

    // Citations for a dropped object go with it. A quote whose object was
    // never approved is not evidence for anything a caller may say.
    const kept = new Set(objects.map((o) => o.id));
    const citations = (pack.citations ?? []).filter((c) => kept.has(c.object_id));

    const untrusted: Finding[] = [];
    const scan = (value: unknown, path: string) =>
      untrusted.push(...scanText(value, path, { maxLength: this.maxTextLength }));

    for (const [i, o] of objects.entries()) {
      scan(o.title, `contextPack.knowledge_objects[${i}].title`);
      scan(o.summary, `contextPack.knowledge_objects[${i}].summary`);
    }
    for (const [i, c] of citations.entries()) {
      scan(c.quote, `contextPack.citations[${i}].quote`);
      scan(c.title, `contextPack.citations[${i}].title`);
    }
    for (const [i, e] of (pack.evidence ?? []).entries()) {
      scan(e.content_excerpt, `contextPack.evidence[${i}].content_excerpt`);
    }
    for (const [i, c] of (pack.caveats ?? []).entries()) {
      scan(c, `contextPack.caveats[${i}]`);
    }
    scan(pack.answer_guidance, "contextPack.answer_guidance");

    const diagnostics = untrusted.map(describeFinding);
    if (droppedUnpublished.length > 0) {
      diagnostics.push(
        `${droppedUnpublished.length} knowledge object(s) were not published and were dropped: ` +
          droppedUnpublished.join(", "),
      );
    }

    return {
      usable: decision === "allowed" && objects.length > 0,
      decision,
      packId: pack.context_pack_id ?? "",
      question: pack.question ?? question,
      objects,
      citations,
      evidence: pack.evidence ?? [],
      caveats: pack.caveats ?? [],
      missingContext: pack.missing_context ?? [],
      confidence: typeof pack.confidence === "number" ? pack.confidence : undefined,
      freshness: pack.freshness ?? { status: "unknown" },
      droppedUnpublished,
      untrusted,
      diagnostics,
    };
  }
}

/**
 * Why a pack cannot be used, in one sentence a person can act on.
 *
 * Exists so the three ways of being unusable stay three answers. A caller that
 * renders one string for all of them is the caller that tells a user their
 * data is missing when it is actually restricted.
 */
export function explainUnusable(result: ContextPackResult): string | undefined {
  if (result.usable) return undefined;
  if (result.decision === "denied") {
    return "This context is restricted for the current scope. It exists; it was not returned.";
  }
  if (result.droppedUnpublished.length > 0 && result.objects.length === 0) {
    return "The only matching knowledge is still in draft. Approved context is required.";
  }
  if (result.missingContext.length > 0) {
    return `No approved context covers this: ${result.missingContext.join("; ")}`;
  }
  return "No approved knowledge matched this question.";
}
