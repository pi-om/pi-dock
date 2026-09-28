const API = {
  base: '',

  async get(path) {
    const r = await fetch(this.base + path);
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    return r.json();
  },

  async post(path, body, isFormData = false) {
    const opts = { method: 'POST' };
    if (isFormData) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(this.base + path, opts);
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || r.statusText);
    }
    return r.json();
  },

  images: {
    list: () => API.get('/api/images'),
    loadTar: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return API.post('/api/images/load', fd, true);
    },
    pull: (name) => {
      const fd = new FormData();
      fd.append('name', name);
      return API.post('/api/images/pull', fd, true);
    },
  },

  containers: {
    list: () => API.get('/api/containers'),
    logs: (id, tail = 300) => API.get(`/api/containers/${encodeURIComponent(id)}/logs?tail=${tail}`),
    stop: (id) => API.post(`/api/containers/${encodeURIComponent(id)}/stop`, {}),
    start: (id) => API.post(`/api/containers/${encodeURIComponent(id)}/start`, {}),
  },

  stacks: {
    list: () => API.get('/api/stacks'),
    get: (name) => API.get(`/api/stacks/${encodeURIComponent(name)}`),
    service: (stackName, serviceName) =>
      API.get(`/api/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(serviceName)}`),
    uploadCompose: (name, file) => {
      const fd = new FormData();
      fd.append('file', file);
      return API.post(`/api/stacks/${encodeURIComponent(name)}/update-compose`, fd, true);
    },
    updateServiceImage: (stackName, serviceName, image) => {
      const fd = new FormData();
      fd.append('image', image);
      return API.post(
        `/api/stacks/${encodeURIComponent(stackName)}/services/${encodeURIComponent(serviceName)}/update-image`,
        fd, true
      );
    },
    downloadComposeUrl: (name) => `/api/stacks/${encodeURIComponent(name)}/compose/download`,
  },
};
