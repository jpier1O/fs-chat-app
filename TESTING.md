# Testing Guide

## ✅ Verified Working Features

### Backend (NestJS) - Port 3000

All endpoints tested and working:

```bash
# 1. Create Session
curl -X POST http://localhost:3000/chat/session
# Response: {"sessionId":"uuid"}

# 2. Send Message
curl -X POST http://localhost:3000/chat/{sessionId}/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!"}'
# Response: {"reply":"Echo: Hello!","turnIndex":0}

# 3. Get History
curl http://localhost:3000/chat/{sessionId}/history
# Response: {"turns":[...]}

# 4. Delete Session
curl -X DELETE http://localhost:3000/chat/{sessionId}
# Response: 204 No Content

# 5. Health Check
curl http://localhost:3000/health
# Response: {"status":"ok","timestamp":"...","uptime":123.45}
```

### Frontend (Next.js) - Port 3001

**Access:** http://localhost:3001

## 🧪 Manual Testing Checklist

### Session Management
- [ ] Visit http://localhost:3001
- [ ] Page shows "Initializing chat session..." briefly
- [ ] Chat interface loads with empty conversation
- [ ] Session cookie is set (check DevTools → Application → Cookies)

### Messaging
- [ ] Type a message in the input field
- [ ] Message appears instantly (optimistic UI)
- [ ] Bot reply appears after ~100ms
- [ ] Turn counter increments
- [ ] Timestamp shows "just now"

### Optimistic UI
- [ ] User message appears immediately when sent
- [ ] If backend fails, message disappears (rollback)
- [ ] Error message shows in red banner

### Keyboard Shortcuts
- [ ] Press Enter to send message (without clicking button)
- [ ] Shift+Enter does NOT send (for future multi-line support)

### Auto-scroll
- [ ] Send multiple messages
- [ ] Page automatically scrolls to show latest message
- [ ] Smooth scroll animation

### Loading States
- [ ] Send button shows "Sending..." while in-flight
- [ ] Send button is disabled while sending
- [ ] Input field is disabled while sending
- [ ] Cannot send empty messages

### Error Handling
- [ ] Try sending empty message → Button stays disabled
- [ ] Stop backend → Send message → Error banner appears
- [ ] Restart backend → Messages work again

### Session Expiry (30 min timeout)
To test quickly, modify `be/src/session/session.service.ts`:
```typescript
private readonly SESSION_TIMEOUT_MS = 10 * 1000; // 10 seconds for testing
```

- [ ] Create session and send message
- [ ] Wait 10+ seconds
- [ ] Send another message
- [ ] "Session Expired" banner appears
- [ ] Page reloads automatically
- [ ] New session created

### Relative Timestamps
- [ ] New message shows "just now"
- [ ] Wait 1 minute → Shows "1 minute ago"
- [ ] Wait 1 hour → Shows "1 hour ago"

### Responsive Design
- [ ] Resize browser window
- [ ] Chat bubbles adjust width
- [ ] Layout remains usable on mobile sizes
- [ ] Input and button stack properly

## 🐛 Known Warnings (Safe to Ignore)

### Browser Console Warning
```
State loaded from storage couldn't be migrated since no migrate function was provided
```
**Cause:** Next.js devtools trying to restore state  
**Impact:** None - this is cosmetic  
**Action:** Ignore

### Terminal Warning (First Load)
```
Failed to create session: Error: Cookies can only be modified in a Server Action or Route Handler
```
**Cause:** Initial page load before session exists  
**Impact:** None - client-side creates session via Route Handler  
**Action:** Ignore - this is expected behavior

## 🔍 Debugging Tips

### Check Backend Logs
```bash
# In terminal running backend
# Look for:
[Nest] LOG [RouterExplorer] Mapped {/chat/session, POST} route
[Nest] LOG [NestApplication] Nest application successfully started
```

### Check Frontend Logs
```bash
# In terminal running frontend
# Look for:
✓ Ready in 375ms
GET / 200 in 52ms
```

### Check Browser DevTools

**Network Tab:**
- POST /api/session → 200 (creates session)
- POST http://localhost:3000/chat/{id}/message → 200 (sends message)

**Application Tab → Cookies:**
- `sessionId` cookie should be present
- HttpOnly: ✓
- SameSite: Lax
- Max-Age: 1800 (30 minutes)

**Console Tab:**
- Should be mostly clean except for the devtools warning

## 🧪 API Testing with curl

### Complete Flow Test
```bash
# 1. Create session via frontend API
SESSION_RESPONSE=$(curl -s -X POST http://localhost:3001/api/session)
SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# 2. Send first message
curl -X POST "http://localhost:3000/chat/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello, how are you?"}'

# 3. Send second message
curl -X POST "http://localhost:3000/chat/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"Tell me a joke"}'

# 4. Get full history
curl "http://localhost:3000/chat/$SESSION_ID/history" | jq

# 5. Delete session
curl -X DELETE "http://localhost:3000/chat/$SESSION_ID"
```

### Error Cases Test
```bash
# Test 404 - Unknown session
curl -X POST "http://localhost:3000/chat/invalid-id/message" \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}'
# Expected: {"statusCode":404,"message":["Session invalid-id not found"],...}

# Test 400 - Empty message
curl -X POST "http://localhost:3000/chat/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -d '{"message":""}'
# Expected: {"statusCode":400,"message":["Message cannot be empty"],...}

# Test 410 - Expired session (after 30 min or modified timeout)
# Wait for timeout, then:
curl "http://localhost:3000/chat/$SESSION_ID/history"
# Expected: {"statusCode":410,"message":["Session ... has expired"],...}
```

## 📊 Performance Benchmarks

### Expected Response Times
- Session creation: < 50ms
- Send message: < 100ms
- Get history: < 50ms
- Page load (with session): < 200ms
- Page load (without session): < 500ms (includes session creation)

### Rate Limiting
- Max 10 requests per minute per IP
- 11th request returns 429 with `retryAfter` header

## ✅ Success Criteria

All of the following should work:

1. ✅ Backend starts without errors
2. ✅ Frontend starts without errors
3. ✅ Can create session via API
4. ✅ Can send messages and get replies
5. ✅ Can view conversation history
6. ✅ Optimistic UI updates work
7. ✅ Error handling works (404, 410, 400)
8. ✅ Session expiry works
9. ✅ Auto-scroll works
10. ✅ Keyboard shortcuts work
11. ✅ Relative timestamps work
12. ✅ HTTP-only cookies are set
13. ✅ Rate limiting works
14. ✅ Health check endpoint works

## 🚀 Next Steps

Once all tests pass, you're ready for:
- Part C: LLM Integration (Gemini streaming)
- Docker setup
- Production deployment
- Additional features (Redis, Edge Runtime, etc.)
