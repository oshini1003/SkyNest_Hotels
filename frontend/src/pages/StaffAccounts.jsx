import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isCurrentStaff } from "../services/staffBookingApi";
import {
  canCreateStaff, clearStaffCreationAttempt, createStaffAccount,
  loadStaffCreation, parseStaffDraft, readStaffCreationAttempt,
} from "../services/staffAccountApi";
import "./StaffAccounts.css";

const emptyDraft = () => ({ name: "", email: "", role: "Receptionist", branchId: "", username: "", password: "", confirmPassword: "" });
const roles = [
  { value: "Admin", label: "Administrator", detail: "Create staff accounts and manage hotel information across branches." },
  { value: "Manager", label: "Manager", detail: "Manage property information and view reports across branches." },
  { value: "Receptionist", label: "Receptionist", detail: "Manage arrivals, payments and departures at the assigned branch." },
  { value: "ServiceStaff", label: "Service staff", detail: "Record guest services at the assigned branch." },
];
const roleLabel = (value) => roles.find((role) => role.value === value)?.label || value;

export default function StaffAccounts({ session }) {
  return <StaffAccountsSession key={`${session?.staff?.staffId}:${session?.token}`} session={session} />;
}

function StaffAccountsSession({ session }) {
  const token = session?.token;
  const staffId = session?.staff?.staffId;
  const permitted = canCreateStaff(session?.staff?.role) && isCurrentStaff(token);
  const [initialAttempt] = useState(() => {
    if (!permitted) return { entry: null, error: "" };
    try { return { entry: readStaffCreationAttempt(staffId), error: "" }; }
    catch (error) { return { entry: { stage: "unverified" }, error: error.message }; }
  });
  const [catalogue, setCatalogue] = useState({ loading: true, branches: [], error: "" });
  const [draft, setDraft] = useState(emptyDraft);
  const [review, setReview] = useState(null);
  const [attempt, setAttempt] = useState(initialAttempt.entry);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState(initialAttempt.error);
  const [confirmedNotCreated, setConfirmedNotCreated] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const readVersion = useRef(0);
  const readController = useRef(null);
  const actionController = useRef(null);
  const heading = useRef(null);
  const errorBox = useRef(null);
  const stage = attempt?.stage || (pending ? "saving" : review ? "review" : "details");
  const editable = permitted && !catalogue.loading && !catalogue.error && !attempt && !pending;
  const branchRequired = ["Receptionist", "ServiceStaff"].includes(draft.role);
  const selectedRole = roles.find((role) => role.value === draft.role);

  async function loadOptions() {
    if (!permitted || busy.current || !isCurrentStaff(token)) return;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++readVersion.current;
    setCatalogue((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const data = await loadStaffCreation(token, controller.signal);
      if (!mounted.current || version !== readVersion.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setCatalogue({ loading: false, branches: [...data.branches].sort((a, b) => a.Name.localeCompare(b.Name, "en-LK")), error: "" });
    } catch (error) {
      if (!mounted.current || version !== readVersion.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setCatalogue({ loading: false, branches: [], error: error.message });
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadOptions();
    return () => {
      mounted.current = false;
      // Invalidate any read started after the initial render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++readVersion.current;
      // Use the latest read, including any retry started after mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      readController.current?.abort();
      // Abort the action started after mount, not a captured earlier controller.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      actionController.current?.abort();
    };
    // A new staff session remounts this component and discards its draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { heading.current?.focus(); }, [stage]);
  useEffect(() => { if (actionError) errorBox.current?.focus(); }, [actionError]);

  function updateDraft(field, value) {
    if (!editable || busy.current || review) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setActionError("");
  }

  function reviewDraft(event) {
    event.preventDefault();
    if (!editable || busy.current) return;
    try {
      const normalized = parseStaffDraft(draft);
      if (draft.password !== draft.confirmPassword) throw new Error("The two passwords do not match. Please enter them again.");
      if (normalized.branchId !== null && !catalogue.branches.some((branch) => branch.BranchID === normalized.branchId)) {
        throw new Error("Select one of the listed branches before continuing.");
      }
      setReview(normalized);
      setActionError("");
    } catch (error) { setActionError(error.message); }
  }

  async function confirmCreation() {
    if (!review || !editable || busy.current || !isCurrentStaff(token)) return;
    busy.current = true;
    setPending(true);
    setActionError("");
    const controller = new AbortController();
    actionController.current = controller;
    const username = review.username;
    try {
      const receipt = await createStaffAccount(review, token, controller.signal);
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token)) return;
      setAttempt({ stage: "saved", username: receipt.username, receipt });
      setDraft(emptyDraft());
      setReview(null);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || !isCurrentStaff(token) || error.name === "AbortError") return;
      setDraft((previous) => ({ ...previous, password: "", confirmPassword: "" }));
      setReview(null);
      try {
        const savedAttempt = readStaffCreationAttempt(staffId);
        if (savedAttempt) setAttempt(savedAttempt);
        else if (error.outcomeUnknown) setAttempt({ stage: "pending", username });
      } catch {
        setAttempt({ stage: "unverified" });
      }
      setActionError(error.message);
    } finally {
      busy.current = false;
      if (mounted.current && isCurrentStaff(token)) setPending(false);
    }
  }

  function startAnother() {
    if (!permitted || busy.current || !isCurrentStaff(token)) return;
    try {
      clearStaffCreationAttempt(staffId, { confirmedNotCreated: attempt?.stage === "pending" && confirmedNotCreated });
      setAttempt(null);
      setDraft(emptyDraft());
      setReview(null);
      setConfirmedNotCreated(false);
      setActionError("");
      void loadOptions();
    } catch (error) { setActionError(error.message); }
  }

  if (!permitted) return <section className="staff-accounts-page">
    <div className="sa-access"><p className="sa-eyebrow">STAFF ACCOUNTS</p><h1>Administrator access required</h1>
      <p>Only an administrator can create staff accounts. Return to your workspace to continue with your available tasks.</p>
      <Link className="sa-button" to="/staff">Back to staff workspace <span aria-hidden="true">→</span></Link>
    </div>
  </section>;

  const receipt = attempt?.stage === "saved" ? attempt.receipt : null;
  const reviewBranch = review && catalogue.branches.find((branch) => branch.BranchID === review.branchId);
  return <section className="staff-accounts-page">
    <nav className="sa-navigation" aria-label="Breadcrumb"><Link to="/staff">Staff workspace</Link><span aria-hidden="true">/</span><span>Staff accounts</span></nav>
    <header className="sa-heading"><div><p className="sa-eyebrow">PEOPLE & HOSPITALITY</p><h1>Create a staff account</h1>
      <p className="sa-intro">Welcome a team member to SkyNest. Set their role, choose their branch and prepare their sign-in details.</p></div>
      <div className="sa-admin-note"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="13" cy="10" r="5" /><path d="M4 27v-5a9 9 0 0 1 17-4M21 22h9m-4.5-4.5v9" /></svg><div><span>ADMINISTRATOR WORKSPACE</span><p>Thoughtful access for every member of your team.</p></div></div>
    </header>

    {actionError && <div className="sa-error" role="alert" tabIndex="-1" ref={errorBox}>{actionError}</div>}

    {catalogue.loading ? <div className="sa-state" role="status"><span className="sa-loading-mark" aria-hidden="true" /><h2>Preparing account details</h2><p>Checking your access and loading the available branches.</p></div>
      : catalogue.error ? <div className="sa-state sa-state--error"><h2>We could not prepare this form</h2><p role="alert">{catalogue.error}</p><button type="button" className="sa-button" onClick={loadOptions}>Try again</button></div>
        : receipt ? <div className="sa-complete">
      <span className="sa-complete-mark" aria-hidden="true">✓</span><p className="sa-eyebrow">ACCOUNT CREATED</p><h2 ref={heading} tabIndex="-1">Welcome, {receipt.name}</h2>
      <p>The new staff account was created. Your administrator account remains signed in.</p>
      <dl className="sa-summary"><div><dt>Staff reference</dt><dd>#{receipt.staffId}</dd></div><div><dt>Username</dt><dd>{receipt.username}</dd></div><div><dt>Role</dt><dd>{roleLabel(receipt.role)}</dd></div></dl>
      <p className="sa-help">Share the sign-in details privately with the team member. They can change their password from their staff workspace after signing in.</p>
      {receipt.storageNotice && <p className="sa-recovery-note" role="status">{receipt.storageNotice}</p>}
      <div className="sa-actions"><button type="button" className="sa-button" onClick={startAnother}>Create another account <span aria-hidden="true">→</span></button><Link to="/staff" className="sa-button sa-button--outline">Back to workspace</Link></div>
    </div> : attempt ? <div className="sa-recovery">
      <p className="sa-eyebrow">CHECK BEFORE CONTINUING</p><h2 ref={heading} tabIndex="-1">{attempt.stage === "pending" ? "The account result needs checking" : "Account creation is paused"}</h2>
      {attempt.username && <p className="sa-attempt-user">Username: <strong>{attempt.username}</strong></p>}
      <p>A previous account request could not be confirmed. It may already have succeeded. Wait for the original request to finish, then check with your system administrator before sending another request for this person.</p>
      <p className="sa-help">The password has not been kept. This page cannot look up existing staff accounts.</p>
      {attempt.stage === "pending" ? <><label className="sa-checkbox"><input type="checkbox" checked={confirmedNotCreated} onChange={(event) => setConfirmedNotCreated(event.target.checked)} /><span>I have checked with the system administrator and confirmed that this account was <strong>not created</strong>.</span></label>
        <div className="sa-actions"><button type="button" className="sa-button" disabled={!confirmedNotCreated} onClick={startAnother}>Start a new request</button><Link to="/staff" className="sa-button sa-button--outline">Back to workspace</Link></div></>
        : <Link to="/staff" className="sa-button sa-button--outline">Back to workspace</Link>}
    </div> : <div className="sa-layout">
          <div className="sa-editor">
            <ol className="sa-steps" aria-label="Account creation steps"><li className={!review ? "is-current" : "is-complete"} aria-current={!review ? "step" : undefined}><span>01</span> Account details</li><li className={review ? "is-current" : ""} aria-current={review ? "step" : undefined}><span>02</span> Review & create</li></ol>
            {review ? <div className="sa-review" aria-busy={pending}>
              <p className="sa-eyebrow">READY FOR YOUR REVIEW</p><h2 ref={heading} tabIndex="-1">Check the account details</h2><p>Make sure the role and branch are right before creating this account.</p>
              <dl className="sa-summary"><div><dt>Team member</dt><dd>{review.name}</dd></div><div><dt>Email</dt><dd>{review.email || "Not provided"}</dd></div><div><dt>Role</dt><dd>{roleLabel(review.role)}</dd></div><div><dt>Branch assignment</dt><dd>{reviewBranch ? `${reviewBranch.Name} · ${reviewBranch.Location}` : "No branch assigned"}</dd></div><div><dt>Username</dt><dd>{review.username}</dd></div><div><dt>Password</dt><dd>Password entered · hidden for privacy</dd></div></dl>
              {["Admin", "Manager"].includes(review.role) && <p className="sa-scope-note">This role has access across branches. A branch assignment does not limit that access.</p>}
              <p className="sa-help">Creating this account will allow the team member to sign in with the username and password you entered.</p>
              <div className="sa-actions"><button type="button" className="sa-button" disabled={pending} onClick={confirmCreation}>{pending ? "Creating account…" : "Create staff account"}<span aria-hidden="true">→</span></button><button type="button" className="sa-button sa-button--outline" disabled={pending} onClick={() => { if (!busy.current) { setReview(null); setActionError(""); } }}>Back to details</button></div>
              {pending && <p className="sa-help" role="status">Please wait while the account is created. Do not submit another request.</p>}
            </div> : <form className="sa-form" onSubmit={reviewDraft} noValidate>
              <p className="sa-eyebrow">A NEW MEMBER OF THE TEAM</p><h2 ref={heading} tabIndex="-1">Account details</h2><p className="sa-form-intro">All fields are required unless marked optional.</p>
              <fieldset disabled={!editable}><legend className="sa-sr-only">Staff account details</legend>
                <div className="sa-fields"><div className="sa-field sa-field--full"><label htmlFor="sa-name">Full name</label><input id="sa-name" name="name" autoComplete="name" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} required /></div>
                  <div className="sa-field sa-field--full"><label htmlFor="sa-email">Email <span>(optional)</span></label><input id="sa-email" name="email" type="email" autoComplete="email" value={draft.email} onChange={(event) => updateDraft("email", event.target.value)} /></div>
                  <div className="sa-field"><label htmlFor="sa-role">Role</label><select id="sa-role" name="role" value={draft.role} aria-describedby="sa-role-hint" onChange={(event) => updateDraft("role", event.target.value)}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></div>
                  <div className="sa-field"><label htmlFor="sa-branch">Branch <span>{branchRequired ? "" : "(optional)"}</span></label><select id="sa-branch" name="branchId" value={draft.branchId} aria-describedby="sa-branch-hint" required={branchRequired} onChange={(event) => updateDraft("branchId", event.target.value)}><option value="">{branchRequired ? "Select a branch" : "No branch assigned"}</option>{catalogue.branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.Name} · {branch.Location}</option>)}</select></div>
                  <div className="sa-selection-notes sa-field--full"><p id="sa-role-hint"><strong>{selectedRole.label}:</strong> {selectedRole.detail}</p><p id="sa-branch-hint">{branchRequired ? "This team member will work with bookings from their assigned branch." : "Administrators and managers have access across branches, even when a branch is assigned."}</p>{branchRequired && catalogue.branches.length === 0 && <p className="sa-empty-branches">There are no branches available. Create a branch before adding reception or service staff.</p>}</div>
                </div>
                <div className="sa-signin-heading"><span aria-hidden="true">02</span><div><h3>Sign-in details</h3><p>Choose a username and share the password privately.</p></div></div>
                <div className="sa-fields"><div className="sa-field sa-field--full"><label htmlFor="sa-username">Username</label><input id="sa-username" name="username" autoComplete="off" autoCapitalize="none" spellCheck="false" value={draft.username} onChange={(event) => updateDraft("username", event.target.value)} required /></div>
                  <div className="sa-field"><label htmlFor="sa-password">Password</label><input id="sa-password" name="password" type="password" autoComplete="new-password" aria-describedby="sa-password-hint" value={draft.password} onChange={(event) => updateDraft("password", event.target.value)} required /><span className="sa-field-hint" id="sa-password-hint">Use at least 6 characters.</span></div>
                  <div className="sa-field"><label htmlFor="sa-confirm-password">Confirm password</label><input id="sa-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" value={draft.confirmPassword} onChange={(event) => updateDraft("confirmPassword", event.target.value)} required /></div>
                </div>
                <div className="sa-form-bottom"><p>Your administrator session stays signed in.</p><button type="submit" className="sa-button" disabled={branchRequired && catalogue.branches.length === 0}>Review account <span aria-hidden="true">→</span></button></div>
              </fieldset>
            </form>}
          </div>
          <aside className="sa-guide"><p className="sa-eyebrow">THE RIGHT ACCESS</p><h2>One team.<br />Different responsibilities.</h2><p className="sa-guide-intro">Choose the role that matches the team member’s daily work.</p><ul>{roles.map((role) => <li key={role.value} className={(review?.role || draft.role) === role.value ? "is-selected" : ""}><span className="sa-role-mark" aria-hidden="true">{role.value === "Admin" ? "A" : role.value === "Manager" ? "M" : role.value === "Receptionist" ? "R" : "S"}</span><div><h3>{role.label}</h3><p>{role.detail}</p></div></li>)}</ul><div className="sa-guide-footnote"><span aria-hidden="true">↗</span><p>Need to return to another task? Your <Link to="/staff">staff workspace</Link> is one step away.</p></div></aside>
        </div>}
  </section>;
}
