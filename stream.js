// Fetch-based SSE keeps bearer tokens in headers and cookies HttpOnly. No token enters a URL.
export function parseEventFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? {event, data:data.join("\n")} : null;
}

export function openPickupStream({path, token, onChange, onFallback = () => {}, onState = () => {}, fetcher = globalThis.fetch}) {
  if (!/^\/api\/v1\/(pickups|ride-requests)\/[a-f0-9-]{36}\/events$/.test(path)) throw new Error("Invalid pickup stream path");
  let stopped=false, controller=null, retry=null, watchdog=null, delay=1000;
  const touch=()=>{ clearTimeout(watchdog); watchdog=setTimeout(()=>controller?.abort(),25000); };
  const run=async()=>{
    controller=new AbortController(); onState(false); touch();
    try {
      const headers={Accept:"text/event-stream"};
      if (token) headers.Authorization=`Bearer ${token}`;
      const response=await fetcher(path,{headers,credentials:token?"omit":"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:controller.signal});
      if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw new Error("Stream unavailable");
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer="";
      try {
        while (!stopped) {
          const {done,value}=await reader.read();
          if (done) break;
          touch(); buffer=(buffer+decoder.decode(value,{stream:true})).replace(/\r\n/g,"\n");
          if (buffer.length>131072) throw new Error("Stream frame too large");
          let boundary;
          while ((boundary=buffer.indexOf("\n\n"))>=0) {
            const frame=parseEventFrame(buffer.slice(0,boundary)); buffer=buffer.slice(boundary+2);
            if (!frame) continue;
            if (frame.event==="access-ended") { onFallback(); return; }
            if (frame.event!=="changed") continue;
            if (frame.data!=="refresh") throw new Error("Invalid stream event");
            delay=1000; onState(true); onChange();
          }
        }
      } finally { await reader.cancel().catch(()=>{}); }
    } catch { if (!stopped) onFallback(); }
    finally {
      clearTimeout(watchdog); onState(false);
      if (!stopped) { retry=setTimeout(run,delay); delay=Math.min(delay*2,15000); }
    }
  };
  void run();
  return {close(){stopped=true;clearTimeout(retry);clearTimeout(watchdog);controller?.abort();onState(false);}};
}
