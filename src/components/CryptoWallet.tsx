"use client";

import { useState, useEffect, useCallback } from 'react';
import FloatingPanel from './FloatingPanel';

// ---------------------------------------------------------------------------
// SVG Icons (inline, no external libraries)
// ---------------------------------------------------------------------------
const Icons = {
  Close: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  ),
  Copy: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Refresh: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  ),
  Wallet: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  Lock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Warning: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Coin = 'btc' | 'xmr';
type PanelState = 'locked' | 'unlocked' | 'setup';

interface WalletListEntry {
  coin: string;
  name: string;
  createdAt: string;
  address: string;
}

interface WalletInfo {
  coin: string;
  name?: string;
  address: string;
  createdAt: string;
}

interface BalanceInfo {
  confirmedBTC?: string;
  unconfirmedBTC?: string;
  txCount?: number;
  message?: string;
}

interface PriceInfo {
  priceUSD?: number | string;
  priceBTC?: number | string;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function walletApi(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch('/api/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { result?: string; error?: string };
  if (json.error) throw new Error(json.error);
  return json.result ? JSON.parse(json.result as string) : json;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface CryptoWalletProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CryptoWallet({ isOpen, onClose }: CryptoWalletProps) {
  const [coin, setCoin] = useState<Coin>('btc');
  const [panelState, setPanelState] = useState<PanelState>('setup');
  const [password, setPassword] = useState('');
  const [newWalletName, setNewWalletName] = useState('');
  const [selectedName, setSelectedName] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [walletList, setWalletList] = useState<WalletListEntry[]>([]);
  const [showMnemonic, setShowMnemonic] = useState(false);

  const coinWallets = walletList.filter(w => w.coin === coin.toUpperCase());
  const hasWallets = coinWallets.length > 0;

  const refreshList = useCallback(() => {
    walletApi({ action: 'list' })
      .then((data) => {
        const d = data as { wallets: WalletListEntry[] };
        setWalletList(d.wallets ?? []);
      })
      .catch(() => {});
  }, []);

  // Load wallet list on open
  useEffect(() => {
    if (!isOpen) return;
    refreshList();
  }, [isOpen, refreshList]);

  // Reset state when switching coin or closing
  useEffect(() => {
    setPassword('');
    setNewWalletName('');
    setError('');
    setSuccessMsg('');
    setMnemonic('');
    setWalletInfo(null);
    setBalance(null);
    setPrice(null);
    setShowMnemonic(false);
  }, [coin, isOpen]);

  // When coin wallet list changes, update selected and panel state
  useEffect(() => {
    if (coinWallets.length > 0) {
      // Keep selectedName if still valid, else use first wallet
      if (!coinWallets.some(w => w.name === selectedName)) {
        setSelectedName(coinWallets[0].name);
      }
      setPanelState('locked');
    } else {
      setSelectedName('default');
      setPanelState('setup');
    }
  }, [walletList, coin]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchBalanceAndPrice = useCallback(async (address: string) => {
    try {
      const [bal, pr] = await Promise.all([
        walletApi({ action: 'balance', coin, address }),
        walletApi({ action: 'price', coin }),
      ]);
      setBalance(bal as BalanceInfo);
      setPrice(pr as PriceInfo);
    } catch (e: unknown) {
      // non-critical — don't block UI
      console.error('Balance/price fetch failed:', e);
    }
  }, [coin]);

  const handleGenerate = async () => {
    setError('');
    setLoading(true);
    try {
      const name = newWalletName.trim() || 'default';
      const data = await walletApi({ action: 'generate', coin, password, name }) as {
        address: string;
        mnemonic: string;
        name: string;
        message: string;
      };
      setMnemonic(data.mnemonic);
      setShowMnemonic(true);
      setSuccessMsg(data.message);
      setWalletInfo({ coin: coin.toUpperCase(), name: data.name, address: data.address, createdAt: new Date().toISOString() });
      setSelectedName(data.name);
      setPanelState('unlocked');
      refreshList();
      fetchBalanceAndPrice(data.address);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await walletApi({ action: 'unlock', coin, password, name: selectedName }) as WalletInfo;
      setWalletInfo(data);
      setPanelState('unlocked');
      fetchBalanceAndPrice(data.address);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!walletInfo) return;
    setBalance(null);
    setPrice(null);
    fetchBalanceAndPrice(walletInfo.address);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (panelState === 'setup') handleGenerate();
      else if (panelState === 'locked') handleUnlock();
    }
  };

  if (!isOpen) return null;

  return (
    <FloatingPanel
      title="Crypto Wallet"
      onClose={onClose}
      defaultW={360}
      defaultH={580}
      defaultX={typeof window !== 'undefined' ? Math.max(40, window.innerWidth - 400) : 600}
      defaultY={80}
    >
      <div className="flex-1 overflow-y-auto flex flex-col bg-[#FDFCF0]" style={{ minHeight: 0 }}>

        {/* Coin tabs */}
        <div className="flex border-b border-black/10">
          {(['btc', 'xmr'] as Coin[]).map((c) => (
            <button
              key={c}
              onClick={() => setCoin(c)}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
                coin === c
                  ? 'bg-black text-white'
                  : 'text-black/40 hover:text-black hover:bg-black/5'
              }`}
            >
              {c === 'btc' ? '₿ Bitcoin' : 'ɱ Monero'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Wallet list — shown when multiple wallets exist */}
          {hasWallets && coinWallets.length > 1 && panelState !== 'unlocked' && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Wallets</p>
              <div className="space-y-1">
                {coinWallets.map((w) => (
                  <button
                    key={w.name}
                    onClick={() => { setSelectedName(w.name); setPanelState('locked'); setError(''); setPassword(''); }}
                    className={`w-full text-left px-3 py-2 rounded border text-[10px] font-black transition-colors ${
                      selectedName === w.name
                        ? 'bg-black text-white border-black'
                        : 'bg-white border-black/15 text-black/60 hover:border-black/40 hover:text-black'
                    }`}
                  >
                    <span className="font-mono">{w.name}</span>
                    <span className="float-right font-mono text-[9px] opacity-60">{w.address}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setPanelState('setup'); setError(''); }}
                className="text-[9px] font-black uppercase tracking-widest text-black/30 hover:text-black transition-colors"
              >
                + New Wallet
              </button>
            </div>
          )}

          {/* Setup — create new wallet */}
          {panelState === 'setup' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/40">
                  Create {coin.toUpperCase()} Wallet
                </p>
                <p className="text-[11px] text-black/60">
                  Generate a new encrypted {coin.toUpperCase()} wallet. Your mnemonic will be shown once.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-black/40">
                  Wallet Name (optional)
                </label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  placeholder="default"
                  className="w-full bg-white border border-black/20 rounded px-3 py-2.5 text-xs font-black outline-none focus:border-black placeholder:text-black/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-black/40">
                  Encryption Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="min 8 characters"
                  className="w-full bg-white border border-black/20 rounded px-3 py-2.5 text-xs font-black outline-none focus:border-black placeholder:text-black/20"
                />
              </div>

              {error && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                {hasWallets && (
                  <button
                    onClick={() => { setPanelState('locked'); setError(''); setNewWalletName(''); }}
                    className="flex-1 py-2.5 border border-black/20 text-[10px] font-black uppercase tracking-widest rounded hover:bg-black/5 transition-colors text-black/40 hover:text-black"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={loading || password.length < 8}
                  className="flex-1 py-2.5 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Generating...' : 'Generate Wallet'}
                </button>
              </div>

              <Warning text="Keep your password safe. If lost, the wallet cannot be recovered." />
            </div>
          )}

          {/* Locked — wallet exists, need password */}
          {panelState === 'locked' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/40">
                  Unlock {coin.toUpperCase()} Wallet
                  {coinWallets.length === 1 && selectedName !== 'default' && (
                    <span className="ml-1 normal-case font-mono">· {selectedName}</span>
                  )}
                </p>
                <p className="text-[11px] text-black/60">Enter your encryption password to access the wallet.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black uppercase tracking-[0.2em] text-black/40">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter password"
                  autoFocus
                  className="w-full bg-white border border-black/20 rounded px-3 py-2.5 text-xs font-black outline-none focus:border-black placeholder:text-black/20"
                />
              </div>

              {error && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <button
                onClick={handleUnlock}
                disabled={loading || !password}
                className="w-full py-2.5 bg-black text-white text-[10px] font-black uppercase tracking-widest rounded hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Unlocking...' : 'Unlock'}
              </button>

              <div className="flex items-center gap-1.5 text-black/30">
                <Icons.Lock />
                <span className="text-[9px] font-black uppercase tracking-widest">Wallet found · Encrypted</span>
              </div>

              <Warning text="Keep your password safe. If lost, the wallet cannot be recovered." />
            </div>
          )}

          {/* Unlocked — show wallet info */}
          {panelState === 'unlocked' && walletInfo && (
            <div className="space-y-5">

              {/* Mnemonic (shown only at creation) */}
              {mnemonic && showMnemonic && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Recovery Phrase</p>
                    <button
                      onClick={() => setShowMnemonic(false)}
                      className="text-[9px] font-black uppercase tracking-widest text-black/30 hover:text-black"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="bg-amber-50 border border-amber-300 rounded p-3">
                    <p className="text-[10px] font-black text-amber-800 leading-relaxed break-words">{mnemonic}</p>
                  </div>
                  <p className="text-[9px] text-amber-700 font-black uppercase tracking-widest">
                    Write this down — shown only once
                  </p>
                </div>
              )}

              {/* Success message */}
              {successMsg && (
                <p className="text-[10px] text-black/50 bg-black/5 border border-black/10 rounded px-3 py-2">
                  {successMsg}
                </p>
              )}

              {/* Address */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Address</p>
                <div className="flex items-start gap-2 bg-white border border-black/15 rounded p-3">
                  <span className="flex-1 text-[10px] font-mono text-black break-all leading-relaxed">
                    {walletInfo.address}
                  </span>
                  <button
                    onClick={() => handleCopy(walletInfo.address)}
                    className="flex-shrink-0 p-1 rounded hover:bg-black/5 transition-colors text-black/40 hover:text-black"
                    title="Copy address"
                  >
                    {copied ? <Icons.Check /> : <Icons.Copy />}
                  </button>
                </div>
                <p className="text-[9px] text-black/30 font-black uppercase tracking-widest">
                  Created {new Date(walletInfo.createdAt).toLocaleDateString()}
                </p>
              </div>

              {/* Balance */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-widest text-black/40">Balance</p>
                  <button
                    onClick={handleRefresh}
                    className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-black/30 hover:text-black transition-colors"
                  >
                    <Icons.Refresh />
                    Refresh
                  </button>
                </div>
                <div className="bg-white border border-black/15 rounded p-3 space-y-1">
                  {!balance ? (
                    <p className="text-[10px] text-black/30 font-black animate-pulse">Fetching...</p>
                  ) : balance.message ? (
                    <p className="text-[10px] text-black/60">{balance.message}</p>
                  ) : (
                    <>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[9px] font-black uppercase tracking-widest text-black/30">Confirmed</span>
                        <span className="text-sm font-black tabular-nums">
                          {balance.confirmedBTC ?? '0.00000000'} BTC
                        </span>
                      </div>
                      {balance.unconfirmedBTC && parseFloat(balance.unconfirmedBTC) !== 0 && (
                        <div className="flex justify-between items-baseline">
                          <span className="text-[9px] font-black uppercase tracking-widest text-black/30">Pending</span>
                          <span className="text-xs font-black tabular-nums text-black/50">
                            {balance.unconfirmedBTC} BTC
                          </span>
                        </div>
                      )}
                      {typeof balance.txCount === 'number' && (
                        <div className="flex justify-between items-baseline pt-1 border-t border-black/5">
                          <span className="text-[9px] font-black uppercase tracking-widest text-black/20">Transactions</span>
                          <span className="text-[10px] font-black text-black/40">{balance.txCount}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Price */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-black/40">
                  {coin.toUpperCase()} Price
                </p>
                <div className="bg-white border border-black/15 rounded p-3">
                  {!price ? (
                    <p className="text-[10px] text-black/30 font-black animate-pulse">Fetching...</p>
                  ) : (
                    <div className="flex justify-between items-baseline">
                      <span className="text-[9px] font-black uppercase tracking-widest text-black/30">USD</span>
                      <span className="text-sm font-black tabular-nums">
                        ${typeof price.priceUSD === 'number'
                          ? price.priceUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : (price.priceUSD ?? 'N/A')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Lock button */}
              <button
                onClick={() => {
                  setPanelState('locked');
                  setWalletInfo(null);
                  setBalance(null);
                  setPrice(null);
                  setMnemonic('');
                  setShowMnemonic(false);
                  setPassword('');
                  setSuccessMsg('');
                }}
                className="w-full py-2 border border-black/20 text-[10px] font-black uppercase tracking-widest rounded hover:bg-black/5 transition-colors text-black/50 hover:text-black"
              >
                Lock Wallet
              </button>

              <Warning text="Keep your password safe. If lost, the wallet cannot be recovered." />
            </div>
          )}
        </div>
      </div>
    </FloatingPanel>
  );
}

// ---------------------------------------------------------------------------
// Warning sub-component
// ---------------------------------------------------------------------------
function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 text-black/40">
      <Icons.Warning />
      <span className="text-[9px] font-black uppercase tracking-widest leading-relaxed">{text}</span>
    </div>
  );
}
