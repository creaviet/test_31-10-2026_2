The idea:
Develop a way for the user to recover his passkey.

When registering his passkey on keycloak, he should get the 8-12 "Einmalcode" that he has to store or save somewhere. 

On the login page there should be an additional option "Passkey verloren". If he clicks on it, he should be prompted with a filed for entering his PENR (more on that later in "context" below) and his "Einmalcode". Once this is accepted, he should be able to create a new Passkey (just like when he first registered his passkey on keycloak)

Context:
Something that is currently not implemented, yet (I need you to implement this otherwise the recover flow won't work):
- Every user in the portal has a PENR (= "Persönliche Nummer")
- Every portal has it's own realm in keycloak
- In total there are 9 portals and thus 9 realms. But for the prototype only 3 are sufficient to implement.
