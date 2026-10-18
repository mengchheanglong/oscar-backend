import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateOpenApiDocument, OPENAPI_CONTROLLERS } from '../../scripts/generate-openapi';

describe('Offline API contract', () => {
  it('documents every active HTTP controller and resolves schema/security references', async () => {
    const classes: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.controller.ts')) {
          const source = readFileSync(path, 'utf8');
          for (const match of source.matchAll(/export class (\w+Controller)\b/g))
            classes.push(match[1]!);
        }
      }
    };
    walk(join(__dirname, '../../src/modules'));
    expect(OPENAPI_CONTROLLERS.map((controller) => controller.name).sort()).toEqual(classes.sort());

    const document = await generateOpenApiDocument();
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === 'string' && object.$ref.startsWith('#/')) {
        let target: unknown = document;
        for (const segment of object.$ref.slice(2).split('/'))
          target = (target as Record<string, unknown> | undefined)?.[segment];
        expect({ reference: object.$ref, exists: target !== undefined }).toMatchObject({
          exists: true,
        });
      }
      for (const child of Object.values(object)) inspect(child);
    };
    inspect(document);
    expect(document.components?.securitySchemes?.cookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'aiws_session',
    });
    expect(document.paths['/api/v1/auth/api-keys']).toBeDefined();
    expect(document.paths['/api/v1/projects/{projectId}/ai/proposals/{id}/confirm']).toBeDefined();
    expect(
      document.paths['/api/v1/projects/{projectId}/integrations/github/connect'],
    ).toBeDefined();
  });
});
