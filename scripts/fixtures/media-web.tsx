import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Api, type Call } from '../../packages/client/src/index';
import '../../apps/web/src/style.css';
import { VideoCall } from '../../apps/web/src/VideoCall';
const params = new URLSearchParams(location.search);
const api = new Api(location.origin, async () => params.get('role')!);
function Harness() {
  const [call, setCall] = useState<Call | null>(null);
  const [age, setAge] = useState(0);
  useEffect(() => {
    const advance = () => setAge(15 * 60_000);
    window.addEventListener('homeping-test-age', advance);
    return () => window.removeEventListener('homeping-test-age', advance);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void api.getCall(params.get('id')!).then(setCall), 500);
    return () => clearInterval(timer);
  }, []);
  if (!call) return <p>Loading</p>;
  return call.status === 'accepted' ? <VideoCall api={api} call={{ ...call, acceptedAt: (call.acceptedAt ?? Date.now()) - age }} changed={setCall} /> : <p>Call ended</p>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
