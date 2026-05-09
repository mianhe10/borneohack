# Firestore Composite Indexes

Create these indexes in the Firebase Console → Firestore → Indexes → Composite.

## loan_applications — user history (showLoanStatus)

| Collection | Fields | Order |
|---|---|---|
| `loan_applications` | `user_id` | Ascending |
| `loan_applications` | `submitted_at` | Descending |

**Query:**
```
db.collection('loan_applications')
  .where('user_id', '==', phone)
  .orderBy('submitted_at', 'desc')
  .limit(5)
```

Without this index, the app falls back to fetching 20 docs and sorting in memory.
