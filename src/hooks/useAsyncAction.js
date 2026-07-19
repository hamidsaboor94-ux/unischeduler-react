import { useState } from 'react';

/** Port of withButtonLoading() as a hook: `const { run, loading } = useAsyncAction();`
    then `<button disabled={loading} onClick={() => run(saveThing())}>` and render
    `{loading ? <span className="spinner"/> : 'Save'}` — no more window.event/closest() hacks. */
export function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  async function run(promise) {
    setLoading(true);
    try {
      return await promise;
    } finally {
      setLoading(false);
    }
  }
  return { run, loading };
}
