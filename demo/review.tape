Output docs/demo.gif
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
Type "# the agent was asked for one enum member; it also changed a retry count"
Enter
Sleep 2s
Type "whyline"
Enter
Sleep 4s
Type "# flagged hunks first, with the ask and the agent's own reason under each"
Enter
Sleep 5s
