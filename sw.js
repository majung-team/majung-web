self.addEventListener('install', event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event=>event.waitUntil(self.clients.claim()));
// Payloads are encrypted by Web Push. They contain only a public pickup ID, route and event kind.
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function notificationTarget(data) {
  if (!idPattern.test(data?.pickupId || '')) return '/account';
  if (data.path === `/?pickup=${data.pickupId}`) return data.path;
  if (/^\/account\?request=[0-9a-f-]{36}$/.test(data.path || '') && idPattern.test(data.path.split('=')[1])) return data.path;
  return '/account';
}
self.addEventListener('push', event => {
  let data=null;
  try { data=event.data?.json(); } catch { /* Earlier deployments send no payload. */ }
  if (data && (!['APPROACHING','ARRIVED'].includes(data.kind) || !idPattern.test(data.pickupId || '') ||
      !Number.isFinite(data.sentAt) || Date.now()-data.sentAt > 120000 || data.sentAt-Date.now()>60000)) return;
  const arrived=data?.kind==='ARRIVED';
  event.waitUntil(self.registration.showNotification(arrived ? '마중 · 차량 도착' : '마중 · 도착이 가까워요', {
    body:arrived ? '차량이 도착했어요. 픽업 화면에서 약속 장소를 확인해주세요.' : '차량이 약 3분 안에 도착해요. 나갈 준비를 해주세요.',
    tag:`majung-${data?.pickupId || 'legacy'}-${arrived ? 'arrived' : 'approaching'}`,
    icon:'/icon-192.png', badge:'/icon-192.png', requireInteraction:arrived,
    data:{path:notificationTarget(data)},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path=event.notification.data?.path;
  // Revalidate persisted notification data; never navigate to an external origin or token URL.
  const safe=typeof path==='string' && (/^\/\?pickup=[0-9a-f-]{36}$/.test(path) || /^\/account\?request=[0-9a-f-]{36}$/.test(path)) ? path : '/account';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows => {
    const exact=windows.find(client=>new URL(client.url).pathname+new URL(client.url).search===safe);
    if (exact) { exact.postMessage({type:'MAJUNG_PICKUP_REFRESH'}); return exact.focus(); }
    return self.clients.openWindow(safe);
  }));
});
