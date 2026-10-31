import type { CatalogResponse, ExperimentResponse } from "../shared/contracts.js";
import { backoff, isRetryable, requestAttempt, retryDelay, RETRY_DELAYS } from './request.js';
export async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try { return await requestAttempt(input, init ?? {}, 20_000, response => response.json() as Promise<T>); }
        catch (error) {
            if (init?.signal?.aborted || (init?.method && init.method !== 'GET') || !isRetryable(error) || attempt >= RETRY_DELAYS.length) throw error;
            await backoff(retryDelay(error, attempt), init?.signal);
        }
    }
}
export const api = {
    catalog: (signal?: AbortSignal) => json<CatalogResponse>("/api/catalog", { signal }),
    experiment: (collectionId: string, taskId: string, datasetId: string, expId: string, signal?: AbortSignal) => json<ExperimentResponse>(`/api/collections/${encodeURIComponent(collectionId)}/tasks/${encodeURIComponent(taskId)}/datasets/${encodeURIComponent(datasetId)}/exps/${encodeURIComponent(expId)}/records`, { signal }),
    reload: () => json<CatalogResponse>("/api/reload", { method: "POST" })
};
