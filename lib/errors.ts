/**
 * Erreur métier attendue (doublon, règle non respectée…), affichée telle
 * quelle à l'utilisateur. `field` rattache le message à un champ du formulaire.
 * Sans dépendance : utilisable par les services ET par les tests unitaires.
 */
export class BusinessError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}
