/** PUBLIC CONTRACT of the integration module. Use-case shaped, returns DTOs from packages/contracts. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- use cases land with the sync services (PMS PR 1)
export interface IntegrationFacade {
  // example(workspaceId: WorkspaceId, input: ExampleRequest): Promise<ExampleDto>;
}

export const INTEGRATION_FACADE = Symbol('INTEGRATION_FACADE');
