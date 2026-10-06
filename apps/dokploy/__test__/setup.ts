import { vi } from "vitest";

/**
 * Mock the DB module so tests that import from @dokploy/server (barrel)
 * never open a real TCP connection to PostgreSQL (e.g. in CI where no DB runs).
 * Without this, loading the server barrel pulls in lib/auth and db, which
 * connect to localhost:5432 and cause ECONNREFUSED.
 */
vi.mock("@dokploy/server/db", () => {
	const createChain = () => {
		const chain: any = {
			set: () => chain,
			where: () => chain,
			values: () => chain,
			returning: () => Promise.resolve([{}]),
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			rightJoin: () => chain,
			fullJoin: () => chain,
			orderBy: () => chain,
			limit: () => chain,
			offset: () => chain,
			groupBy: () => chain,
			having: () => chain,
			then: (resolve: (value: unknown) => void) => {
				resolve([]);
			},
		};
		return chain;
	};

	const tableMock = {
		findFirst: vi.fn(() => Promise.resolve(undefined)),
		findMany: vi.fn(() => Promise.resolve([])),
		insert: vi.fn(() => Promise.resolve([{}])),
		update: vi.fn(() => createChain()),
		delete: vi.fn(() => createChain()),
	};

	return {
		db: {
			select: vi.fn(() => createChain()),
			insert: vi.fn(() => ({
				values: () => ({ returning: () => Promise.resolve([{}]) }),
			})),
			update: vi.fn(() => createChain()),
			delete: vi.fn(() => createChain()),
			query: new Proxy({} as Record<string, typeof tableMock>, {
				get: () => tableMock,
			}),
		},
		dbUrl: "postgres://mock:mock@localhost:5432/mock",
	};
});
