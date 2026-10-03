import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './session-cookies';
import { applyWayfareOpenApi, AUTH_SCHEMES } from './openapi-post-pass';

/** Where Swagger UI and the OpenAPI JSON Orval reads are mounted (api-endpoints-plan §13). */
export const SWAGGER_PATH = 'docs';

/**
 * The CSP Swagger UI needs: its bundle injects an inline initializer script and inline styles,
 * and renders its logo and schema previews from data: URIs.
 */
export const SWAGGER_UI_CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
};

/**
 * One helmet middleware choosing the policy by path: the strict default everywhere, the
 * Swagger UI policy under `/docs` only. A second helmet cannot loosen a header a first one set.
 */
export function securityHeaders(): (req: Request, res: Response, next: NextFunction) => void {
  const strict = helmet();
  const docs = helmet({ contentSecurityPolicy: { directives: SWAGGER_UI_CSP_DIRECTIVES } });
  const docsPrefix = `/${SWAGGER_PATH}`;
  return (req, res, next) => {
    const isDocs =
      req.path === docsPrefix ||
      req.path.startsWith(`${docsPrefix}/`) ||
      req.path.startsWith(`${docsPrefix}-json`);
    (isDocs ? docs : strict)(req, res, next);
  };
}

/** Options for `setupSwagger`. */
export interface SwaggerOptions {
  readonly title: string;
  readonly version: string;
}

/**
 * The OpenAPI document of the running app. Served at `/docs-json` and written to the API
 * client's `openapi.json`, both through here, so the two cannot differ.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  options: SwaggerOptions,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setVersion(options.version)
    // The schemas are zod's JSON Schema (type arrays, prefixItems, $schema): OpenAPI 3.1 says so, 3.0 does not.
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Device access token' },
      AUTH_SCHEMES.deviceBearer,
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Account access token (mobile)',
      },
      AUTH_SCHEMES.accountBearer,
    )
    .addCookieAuth(
      ACCESS_COOKIE,
      { type: 'apiKey', in: 'cookie', name: ACCESS_COOKIE },
      AUTH_SCHEMES.accessCookie,
    )
    .addCookieAuth(
      REFRESH_COOKIE,
      { type: 'apiKey', in: 'cookie', name: REFRESH_COOKIE },
      AUTH_SCHEMES.refreshCookie,
    )
    .addGlobalParameters({
      name: 'X-Wayfare-Client',
      in: 'header',
      required: true,
      schema: { type: 'string', enum: ['console', 'web', 'mobile'] },
    })
    .build();
  return applyWayfareOpenApi(cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)));
}

/** Mounts Swagger UI at `/docs` and the OpenAPI document at `/docs-json`. Call only when `SWAGGER_ENABLED`. */
export function setupSwagger(app: INestApplication, options: SwaggerOptions): void {
  const document = buildOpenApiDocument(app, options);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    // "Try it out" sends the console cookies, and keeps a pasted bearer across reloads.
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });
}
