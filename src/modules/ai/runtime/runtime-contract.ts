export const HERMES_REVISION = 'b9aa9289a8083f2e9d248ad6837b2938f5ee92d7';

export interface RuntimeInput {
  prompt: string;
  context: string;
  model: string;
  apiKey: string;
}

export interface RuntimeCallbacks {
  tool(name: string, args: unknown): Promise<unknown>;
}

export interface AgentRuntime {
  available(): boolean;
  execute(input: RuntimeInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<string>;
}

export const WORKSPACE_TOOLS = [
  {
    name: 'list_local_folders',
    description: 'List private uploaded and connected local folders. No shell access.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'list_local_files',
    description:
      'Find filenames in a connected folder; pages of 100 files. Use nextOffset to continue.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', format: 'uuid' },
        query: { type: 'string', maxLength: 500 },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['folderId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_local_files',
    description:
      'Search live or stored extracted text using a literal query; returns bounded matches and nextOffset. Documents should be discovered by filename and read.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', format: 'uuid' },
        query: { type: 'string', maxLength: 500 },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['folderId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_local_file',
    description:
      'Read live or stored text and extracted PDF/DOCX content in 8000-character pages. Binary files return metadata. Cite the returned citation.',
    parameters: {
      type: 'object',
      properties: {
        folderId: { type: 'string', format: 'uuid' },
        path: { type: 'string', maxLength: 1000 },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['folderId', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_project_evidence',
    description: 'Retrieve cited evidence in the current authorized project.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 2000 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'calculate_pricing',
    description:
      'Calculate revenue, contribution, profit and break-even from explicit assumptions. Does not fetch data or execute code.',
    parameters: {
      type: 'object',
      properties: {
        price: { type: 'number', minimum: 0 },
        variableCost: { type: 'number', minimum: 0 },
        fixedCost: { type: 'number', minimum: 0 },
        units: { type: 'integer', minimum: 0 },
      },
      required: ['price', 'variableCost', 'fixedCost', 'units'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_task_review',
    description:
      'Request human review of one task linked to a current project decision. This only returns a pending draft; it never creates a task.',
    parameters: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', format: 'uuid' },
        title: { type: 'string', maxLength: 500 },
        description: { type: 'string', maxLength: 5000 },
      },
      required: ['decisionId', 'title'],
      additionalProperties: false,
    },
  },
] as const;
