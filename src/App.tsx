import { useEffect, useState } from 'react';
import CustomerView from './CustomerView';
import RepView from './RepView';
import { Header } from './components';
import { goTo } from './lib';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  if (hash.startsWith('#/rep')) return <RepView />;
  if (hash.startsWith('#/customer')) return <CustomerView />;
  return <Landing />;
}

function Landing() {
  return (
    <div className="app">
      <Header subtitle="Your Toyota's next move, figured out together" />
      <main className="landing">
        <p className="eyebrow">Toyota Financial Services · Built on SpacetimeDB</p>
        <h1>Your Toyota's next move, figured out together.</h1>
        <p className="lead">
          Real options from your real contract, explained in plain English. When you want help, a specialist joins the same screen
          live.
        </p>
        <div className="role-grid">
          <button className="role" onClick={() => goTo('#/customer')}>
            <span className="role-kicker">Open on laptop 1</span>
            <span className="role-title">I'm a customer</span>
            <span className="muted">See every option, tune the numbers, bring in a specialist.</span>
          </button>
          <button className="role blue" onClick={() => goTo('#/rep')}>
            <span className="role-kicker">Open on laptop 2</span>
            <span className="role-title">I'm a Toyota specialist</span>
            <span className="muted">Live queue, shared screen, send eligible offers.</span>
          </button>
        </div>
      </main>
    </div>
  );
}
