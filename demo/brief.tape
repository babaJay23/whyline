Output docs/demo-brief.gif
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 680
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Hide
Type "cd $(mktemp -d) && git init -q -b main . && export HOME=$(mktemp -d) && sh $WHYLINE_DEMO_SETUP && clear"
Enter
Sleep 3s
Show
Type "# --brief: headers and flags only, cheap for an agent or a CI job to read"
Enter
Sleep 2s
Type "whyline --brief"
Enter
Sleep 4s
Type "clear"
Enter
Type "# dollars are opt-in; subscriptions are not billed per token"
Enter
Sleep 2s
Type "whyline --brief --prices default"
Enter
Sleep 6s
