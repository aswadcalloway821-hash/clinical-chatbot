/**
 * SessionManager handles in-memory storage of chat history for each user.
 * This keeps the API stateless and ensures context is preserved across webhook calls.
 */
export class SessionManager {
  // Map of phone number to chat history parts
  private static sessions = new Map<string, any[]>();
  
  // Maximum number of message history turns to retain to avoid token bloating
  private static MAX_HISTORY_TURNS = 20;

  /**
   * Retrieves the chat history for a specific phone number.
   * @param phoneNumber The patient's phone number.
   * @returns An array of historical turns.
   */
  public static getHistory(phoneNumber: string): any[] {
    if (!this.sessions.has(phoneNumber)) {
      this.sessions.set(phoneNumber, []);
    }
    return this.sessions.get(phoneNumber) || [];
  }

  /**
   * Saves or updates the chat history for a specific phone number.
   * @param phoneNumber The patient's phone number.
   * @param history The full updated history array.
   */
  public static saveHistory(phoneNumber: string, history: any[]): void {
    let trimmedHistory = [...history];
    
    if (trimmedHistory.length > this.MAX_HISTORY_TURNS) {
      // We want to slice from a safe split point where the history starts cleanly with a user message
      const targetIndex = trimmedHistory.length - this.MAX_HISTORY_TURNS;
      let safeIndex = targetIndex;
      
      // Try moving forward from targetIndex to find a turn with role: 'user' that is NOT a function response
      while (safeIndex < trimmedHistory.length) {
        const turn = trimmedHistory[safeIndex];
        const isUserText = turn.role === 'user' && 
          !turn.parts?.some((p: any) => p.functionResponse !== undefined);
          
        if (isUserText) {
          break;
        }
        safeIndex++;
      }
      
      // If we couldn't find one moving forward, search backward from targetIndex
      if (safeIndex >= trimmedHistory.length) {
        safeIndex = targetIndex;
        while (safeIndex > 0) {
          const turn = trimmedHistory[safeIndex];
          const isUserText = turn.role === 'user' && 
            !turn.parts?.some((p: any) => p.functionResponse !== undefined);
            
          if (isUserText) {
            break;
          }
          safeIndex--;
        }
      }
      
      trimmedHistory = trimmedHistory.slice(safeIndex);
    }
    
    this.sessions.set(phoneNumber, trimmedHistory);
  }

  /**
   * Clears the chat history for a specific phone number.
   * Useful when a patient wants to reset or start a completely new booking.
   * @param phoneNumber The patient's phone number.
   */
  public static clearHistory(phoneNumber: string): void {
    this.sessions.delete(phoneNumber);
    console.log(`🧹 Session cleared for phone number: ${phoneNumber}`);
  }
}
