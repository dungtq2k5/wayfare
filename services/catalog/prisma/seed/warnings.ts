// Imported first by every seed that touches storage: each process warning is a structured line,
// as in the services (conventions §14.1), so the storage client's known one (conventions §17.2) is
// logged once at `info` with its reason, and any other — a real leak included — stays visible.
import { installWarningLogger } from '@wayfare/nest-common/warnings';

installWarningLogger({ env: process.env });
