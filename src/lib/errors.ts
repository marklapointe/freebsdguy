/**
 * Extract a user-facing message from axios-like errors.
 * Prefer server `response.data.message`; otherwise use fallback.
 * (Does not surface raw Error.message — that is for logs, not UI.)
 */
export function axiosErrorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === 'object') {
        const ax = err as { response?: { data?: { message?: string } } };
        if (typeof ax.response?.data?.message === 'string' && ax.response.data.message) {
            return ax.response.data.message;
        }
    }
    return fallback;
}
