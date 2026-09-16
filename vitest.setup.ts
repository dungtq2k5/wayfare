import { Logger } from '@nestjs/common';

// Unit and e2e suites assert on responses, not log lines; failures still surface through assertions.
Logger.overrideLogger(false);
