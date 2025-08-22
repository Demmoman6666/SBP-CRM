// app/customers/new/page.tsx
export default function NewCustomerPage() {
  return (
    <div className="card">
      <h2>Create Customer</h2>
      <form action="/api/customers" method="post" className="grid" style={{ gap: 12 }}>
        <div className="grid grid-2">
          <div><label>Salon Name*</label><input name="salonName" required /></div>
          <div><label>Customer Name*</label><input name="customerName" required /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Address Line 1*</label><input name="addressLine1" required /></div>
          <div><label>Address Line 2</label><input name="addressLine2" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Town</label><input name="town" /></div>
          <div><label>County</label><input name="county" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Post Code</label><input name="postCode" /></div>
          <div><label>Days Open</label><input name="daysOpen" placeholder="e.g. Mon–Sat" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Brands Interested in</label><input name="brandsInterestedIn" /></div>
          <div><label>Sales Rep</label><input name="salesRep" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Customer Number</label><input name="customerNumber" /></div>
          <div><label>Customer Email Address</label><input type="email" name="customerEmailAddress" /></div>
        </div>

        <div className="grid grid-2">
          <div><label>Opening Hours</label><input name="openingHours" /></div>
          <div><label>Number of Chairs</label><input type="number" name="numberOfChairs" min={0} /></div>
        </div>

        <div><label>Notes</label><textarea name="notes" rows={4} /></div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="reset">Reset</button>
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
