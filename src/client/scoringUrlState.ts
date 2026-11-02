export type LabelStatusFilter = "all" | "labelled" | "unlabelled";
export type AgreementFilter = "all" | "agree" | "disagree";
export type ScoringViewState = {
    setId?: string;
    itemId?: string;
    /** Agent label set shown as prefill; "" = explicitly none. */
    prefill?: string;
    presentation?: string;
    pair?: string;
    status: LabelStatusFilter;
    agreement: AgreementFilter;
};
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const labelSet = /^[A-Za-z0-9_-]{1,32}$/;
const optional = <K extends string>(key: K, value: string | null, pattern: RegExp) => value && pattern.test(value) ? { [key]: value } as Record<K, string> : {};

/** Scoring deep links: `/scoring?set=…&item=…&prefill=…&pres=…&pair=…&status=…&agree=…`. */
export function parseScoringState(search: string): ScoringViewState {
    const params = new URLSearchParams(search);
    const status = params.get("status");
    const agreement = params.get("agree");
    const pair = params.get("pair");
    return {
        ...optional("setId", params.get("set"), id), ...optional("itemId", params.get("item"), id),
        // `prefill=` (empty) records an explicit "none"; absent means "default to the first agent set".
        ...(params.get("prefill") === "" ? { prefill: "" } : optional("prefill", params.get("prefill"), labelSet)), ...optional("presentation", params.get("pres"), id),
        ...(pair && pair.length <= 256 ? { pair } : {}),
        status: status === "labelled" || status === "unlabelled" ? status : "all",
        agreement: agreement === "agree" || agreement === "disagree" ? agreement : "all"
    };
}
export function serializeScoringState(state: ScoringViewState): string {
    const params = new URLSearchParams();
    if (state.setId) params.set("set", state.setId);
    if (state.itemId) params.set("item", state.itemId);
    if (state.prefill !== undefined) params.set("prefill", state.prefill);
    if (state.presentation) params.set("pres", state.presentation);
    if (state.pair) params.set("pair", state.pair);
    if (state.status !== "all") params.set("status", state.status);
    if (state.agreement !== "all") params.set("agree", state.agreement);
    const encoded = params.toString();
    return encoded ? `?${encoded}` : "";
}
