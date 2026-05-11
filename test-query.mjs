import { QueryClient } from '@tanstack/query-core';
const queryClient = new QueryClient();
const query = queryClient.fetchQuery({ queryKey: ['test'], queryFn: () => 'data' });
// wait, we need to test useQuery.
