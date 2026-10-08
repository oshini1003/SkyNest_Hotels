import { lazy, Suspense } from "react";
import PageLoading from "./PageLoading";

// Call only at module scope: each page keeps a stable component and import promise.
// A separate boundary for each page shows progress on first visits without
// remounting a form when its existing route state or session profile is updated.
export function lazyPage(load) {
  const Page = lazy(load);
  return function DeferredPage(props) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Page {...props} />
      </Suspense>
    );
  };
}
