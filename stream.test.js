import test from "node:test";
import assert from "node:assert/strict";
import {parseEventFrame,openPickupStream} from "./stream.js";
test("SSE multiline payloads and comments",()=>{
  assert.deepEqual(parseEventFrame("event: snapshot\ndata: {\ndata: \"value\":1}"),{event:"snapshot",data:'{\n"value":1}'});
  assert.equal(parseEventFrame(":keepalive"),null);
});
test("no token or external origin is accepted in a stream URL",()=>{
  for(const path of ["https://example.test/events","/api/v1/pickups/a/events?token=secret","/api/v1/accounts/me/events"])
    assert.throws(()=>openPickupStream({path,onChange(){}}));
});
test("stream uses header auth and can be closed without retrying",async()=>{
  let options,received;
  const encoder=new TextEncoder();
  const stream=openPickupStream({path:"/api/v1/pickups/11111111-1111-1111-1111-111111111111/events",token:"fixture",onChange(){received=true;},
    fetcher:async(path,opts)=>{options=opts;return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('event: changed\ndata: refresh\n\n'));}}),{headers:{"content-type":"text/event-stream"}});}});
  await new Promise(resolve=>setTimeout(resolve,10));stream.close();
  assert.equal(options.headers.Authorization,"Bearer fixture");assert.equal(options.credentials,"omit");assert.equal(received,true);
});
