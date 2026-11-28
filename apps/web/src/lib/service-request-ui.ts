import type { ServiceRequestStatus } from '@floral/domain';

/** Il colore dello stato di una richiesta (M5), uguale nel conto e nell'app della fioreria. */
export const SERVICE_REQUEST_STATUS_BADGE: Readonly<
  Record<ServiceRequestStatus, 'info' | 'warning' | 'success' | 'muted' | 'danger'>
> = {
  NEW: 'info',
  QUOTED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  CANCELLED: 'muted',
  CLOSED: 'muted',
};
