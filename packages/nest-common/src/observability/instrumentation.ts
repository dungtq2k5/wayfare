// OpenTelemetry bootstrap. Imported FIRST by every service's main.ts so auto-instrumentation
// patches pg, @grpc/grpc-js and http before anything requires them (ADR 0058: under CommonJS no
// loader flag is needed).
//
// Configuration is the standard OTel environment: OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_ENDPOINT,
// OTEL_TRACES_SAMPLER (parentbased_always_on), OTEL_SDK_DISABLED.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const disabled = process.env.OTEL_SDK_DISABLED === 'true';

/** The running SDK, or null when tracing is disabled. */
export const otelSdk: NodeSDK | null = disabled
  ? null
  : new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          // File-system spans are noise; DNS and net add nothing the HTTP and gRPC spans lack.
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
          // Only query spans inside a trace: the outbox relay polls every 200 ms with no parent,
          // and each poll would otherwise be a root trace of its own.
          '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
          // Express 5 routes through the `router` package, whose instrumentation adds a span per
          // middleware layer; the Nest and Express instrumentations already name the route.
          '@opentelemetry/instrumentation-router': { enabled: false },
          '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (request) => /^\/(health|metrics)/.test(request.url ?? ''),
          },
        }),
      ],
    });

otelSdk?.start();

/** Flushes and stops tracing; called on shutdown. */
export async function shutdownTracing(): Promise<void> {
  await otelSdk?.shutdown();
}
