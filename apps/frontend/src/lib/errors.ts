import axios from 'axios';

/** Best-effort extraction of a human-readable message from an unknown error. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data: unknown = error.response?.data;
    if (data && typeof data === 'object') {
      const withMessage = data as { message?: unknown; error?: unknown; title?: unknown };
      if (typeof withMessage.message === 'string') return withMessage.message;
      if (typeof withMessage.error === 'string') return withMessage.error;
      if (typeof withMessage.title === 'string') return withMessage.title;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
