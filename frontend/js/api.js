/* Thin fetch wrapper for the Flask API */
const API = {
  async request(method, url, data) {
    const opts = { method, credentials: "same-origin", headers: {} };
    if (data instanceof FormData) {
      opts.body = data;
    } else if (data !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(data);
    }
    let res;
    try {
      res = await fetch("/api" + url, opts);
    } catch (e) {
      throw new Error("Cannot reach the server. Is the backend running?");
    }
    let payload = null;
    try { payload = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return payload;
  },
  get(u) { return this.request("GET", u); },
  post(u, d) { return this.request("POST", u, d === undefined ? {} : d); },
  put(u, d) { return this.request("PUT", u, d); },
  del(u) { return this.request("DELETE", u); },
};
