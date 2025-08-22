export default function LoginPage() {
  return (
    <div className="card" style={{ maxWidth: 420, margin: "80px auto" }}>
      <h2>Staff Login</h2>
      <form method="post" action="/api/login" className="grid">
        <div>
          <label>Access Code</label>
          <input type="password" name="code" placeholder="Enter team access code" required />
        </div>
        <button className="primary" type="submit">Sign in</button>
      </form>
      <p className="small" style={{ marginTop: 10 }}>Ask your admin for the access code.</p>
    </div>
  );
}
