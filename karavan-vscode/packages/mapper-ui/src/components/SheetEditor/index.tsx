import { LuX } from 'react-icons/lu'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet'

const SheetEditor = ({ children, sheetOpen, title }: any) => {
  return (
    <Sheet open={sheetOpen}>
      <SheetContent side="right" className='h-full py-6'>
        <SheetHeader >
          <SheetTitle>{title}</SheetTitle>    
          <SheetClose asChild>
            <LuX/>
          </SheetClose>
        </SheetHeader>
       
            <div className="max-w-full h-full flex flex-col mt-  px-4 overflow-y-auto">
            {children}</div>
       
      </SheetContent>
    </Sheet>
  )
}

export default SheetEditor