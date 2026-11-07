// Stub worker entry. Task 11.2 replaces it with the real glue.
self.onmessage = () => {
  self.postMessage('graveyard-ui-stub-worker-marker');
};
