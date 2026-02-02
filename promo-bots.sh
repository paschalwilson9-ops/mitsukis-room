#!/bin/bash
# Promo bots — keep a live game going on Mitsuki's Room
# These bots play simple poker and occasionally chat

BASE="https://mitsukis-room.onrender.com/api"
KIMI="3b20e138-72d5-4042-8e09-d5c7fae98968"
JIRO="f2d7b7d6-2109-4b7d-ba78-bd9f08de79b5"
ANON="f344c1cf-e598-41cb-bf7a-849263c9d6be"

TOKENS=("$KIMI" "$JIRO" "$ANON")
NAMES=("Kimi" "Jiro" "AnonClawker")

CHAT_LINES=(
  "nice hand"
  "gg"
  "lol"
  "the moon is watching 🌙"
  "fold? really?"
  "all in or nothing"
  "🦞"
  "anyone else here from 4claw?"
  "this dealer talks too much"
  "respect the blinds"
  "I'm just here for the vibes"
  "bomb pot when?"
  "run it twice coward"
)

round=0
while true; do
  round=$((round + 1))
  
  # Get game state from first bot
  STATE=$(curl -s "$BASE/state/$KIMI")
  PHASE=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('phase','unknown'))" 2>/dev/null)
  CURRENT=$(echo "$STATE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('currentPlayer',''))" 2>/dev/null)
  
  if [ "$PHASE" = "unknown" ] || [ -z "$PHASE" ]; then
    sleep 3
    continue
  fi
  
  # Find which bot needs to act
  for i in 0 1 2; do
    TOKEN="${TOKENS[$i]}"
    NAME="${NAMES[$i]}"
    
    BOT_STATE=$(curl -s "$BASE/state/$TOKEN")
    IS_TURN=$(echo "$BOT_STATE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
seat = d.get('mySeat', -1)
current = d.get('currentPlayer', -1)
print('yes' if seat == current else 'no')
" 2>/dev/null)
    
    if [ "$IS_TURN" = "yes" ]; then
      # Simple strategy: random action weighted toward call/check
      ROLL=$((RANDOM % 10))
      if [ $ROLL -lt 5 ]; then
        ACTION="call"
      elif [ $ROLL -lt 8 ]; then
        ACTION="check"
      elif [ $ROLL -lt 9 ]; then
        ACTION="raise"
      else
        ACTION="fold"
      fi
      
      RESULT=$(curl -s -X POST "$BASE/action" \
        -H "Content-Type: application/json" \
        -d "{\"token\": \"$TOKEN\", \"action\": \"$ACTION\"}")
      
      # If action failed (e.g., can't check), try call
      ERROR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
      if [ -n "$ERROR" ] && [ "$ERROR" != "" ]; then
        RESULT=$(curl -s -X POST "$BASE/action" \
          -H "Content-Type: application/json" \
          -d "{\"token\": \"$TOKEN\", \"action\": \"call\"}")
        ERROR2=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)
        if [ -n "$ERROR2" ] && [ "$ERROR2" != "" ]; then
          RESULT=$(curl -s -X POST "$BASE/action" \
            -H "Content-Type: application/json" \
            -d "{\"token\": \"$TOKEN\", \"action\": \"check\"}")
        fi
      fi
      
      echo "[$round] $NAME: $ACTION (phase: $PHASE)"
    fi
  done
  
  # Occasionally chat (1 in 8 rounds)
  if [ $((RANDOM % 8)) -eq 0 ]; then
    CHATTER=$((RANDOM % 3))
    MSG_IDX=$((RANDOM % ${#CHAT_LINES[@]}))
    # Chat via WebSocket isn't easy from bash, skip for now
    echo "[$round] ${NAMES[$CHATTER]} would chat: ${CHAT_LINES[$MSG_IDX]}"
  fi
  
  # Check if any bot busted and needs rebuy
  for i in 0 1 2; do
    TOKEN="${TOKENS[$i]}"
    NAME="${NAMES[$i]}"
    CHIPS=$(curl -s "$BASE/state/$TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
players = d.get('players', [])
seat = d.get('mySeat', -1)
for p in players:
    if p and p.get('seat') == seat:
        print(p.get('chips', 0))
        break
else:
    print(0)
" 2>/dev/null)
    
    if [ "$CHIPS" = "0" ]; then
      curl -s -X POST "$BASE/rebuy" \
        -H "Content-Type: application/json" \
        -d "{\"token\": \"$TOKEN\"}" > /dev/null 2>&1
      echo "[$round] $NAME rebought"
    fi
  done
  
  sleep 2
done
