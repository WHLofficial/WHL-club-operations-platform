export default function Ledger() {
  return (
    <div className="container">
      <h1>财政账本</h1>
      <div className="card empty-state">
        <p className="muted">账本还是空的。期初余额导入之后，每一笔收支都会记在这里。</p>
      </div>
    </div>
  );
}
